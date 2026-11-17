# admin — Build Rules

Scope: `apps/admin/` (Next.js 14 App Router, React 18, Tailwind 3, English only, desktop-first, responsive to tablet).

## Stack
| Concern | Choice |
|---|---|
| Framework | Next.js 14 App Router; every page is a client component under `app/(dashboard)/` behind the auth guard in its `layout.tsx` |
| Styling | Tailwind 3 + `@tailwindcss/forms`; `cn()` from `lib/utils.ts` (clsx + tailwind-merge); variants with `class-variance-authority` |
| Brand | Tailwind `brand` scale = indigo (same as user-app primary). Buttons `brand-600`, focus rings `brand-400`. Sidebar uses the `side` palette. Font: Onest via `next/font` |
| Forms | React Hook Form + Zod (`@hookform/resolvers/zod`) — see `app/login/page.tsx` |
| Charts | Recharts |
| Toasts | `sonner` (`<Toaster>` is mounted in the dashboard layout) |
| Icons | `lucide-react` |
| Data | `lib/api.ts` (`api.get/post/put/patch/delete`) — unwraps `{ data }`, throws `ApiError` with `code`, bounces to `/login` on 401 |
| Auth | `lib/auth-context.tsx` — `useAuth()` gives `user`, `hasRole(...)`, `login`, `logout`; token in localStorage |
| Tests | Vitest + Testing Library; `components/**` and `app/**` run in jsdom |

## Building blocks — use these before writing new ones
| File | Role |
|---|---|
| `components/ui/page-header.tsx` | Title, description, actions, back link, breadcrumb trail. Every page starts with it. |
| `components/ui/button.tsx` | `primary` / `secondary` / `danger` / `ghost`, `sm` / `md`, `loading` |
| `components/ui/dialog.tsx` | Accessible modal: focus trap, Escape, Enter → `[data-dialog-primary]`, stacking |
| `components/ui/form-dialog.tsx` | Dialog wrapping a form with dirty-check on close |
| `components/confirm-provider.tsx` | `const confirm = useConfirm(); if (await confirm({ title, variant: 'danger' })) …` |
| `components/ui/tabs.tsx` | Link or button tabs with roving keyboard focus |
| `components/ui/states.tsx` | `Skeleton`, `TableSkeleton`, `EmptyState`, `ErrorState` |
| `components/stat-card.tsx` | KPI tile |
| `components/status-badge.tsx` | Status pill; tones and labels in `lib/status.ts` (listing/enquiry/offer/deal/rental/part-request statuses) |
| `components/module-placeholder.tsx` | Stand-in for unbuilt modules — replace the page when building the module |
| `components/data-table.tsx` + `table-pagination.tsx` | Sortable, paginated table; rows can be links (`data-row-link`) with keyboard support. Pair with `lib/use-client-list.ts` (client-side filter/sort/page) |
| `components/filter-kit.tsx` | Filter bar + filter popup pieces shared by list pages |
| `components/image-lightbox.tsx` | Full-screen photo viewer — part and machine photos, GST and business documents in moderation/verification |
| `components/ui/record-tabs.tsx` | Tabs on a record page, synced to `?tab=` via `lib/use-tab-param.ts` |
| `components/ui/stale-warning.tsx` | "This data changed — reload" banner |
| `components/layout/keyboard-nav.tsx` | Arrow-key navigation between controls and table rows (mounted in the dashboard layout) |

| Hook / lib | Role |
|---|---|
| `lib/use-url-state.ts` | List filters/search/page kept in the URL so back/forward and shared links work |
| `lib/use-table-page-size.ts` | Remembered rows-per-page per table |
| `lib/load-error.ts` | `classifyLoadError(e)` → not_found / forbidden / failed, for the page's error state |
| `lib/socket.ts` + `lib/use-live-refresh.ts` | Admin socket (`/admin` namespace) and "refetch when the server says this section changed" |
| `lib/back-link.ts` | `?from=` back links so a record page returns to wherever it was opened from |

## Navigation & roles
- Menu groups live in `lib/nav.ts`. Each item lists the `roles` that see it (super_admin sees all). Adding a module = add its nav item + `app/(dashboard)/<route>/page.tsx`.
- The nav only hides; the **API must enforce** the same roles with `requireAdminRole(...)`.
- Every mutating admin endpoint writes `audit_log` with before/after values.

## Rules
- Every page handles loading (`Skeleton`/`TableSkeleton`), empty (`EmptyState`) and error (`ErrorState` with retry) states.
- Destructive actions go through `useConfirm()` with `variant: 'danger'`.
- Money: `formatCurrency` (₹, en-IN grouping); phones: `formatPhone`.
- Use `.tnum` on numeric table columns.
- `pnpm lint` must be warning-free; `pnpm build` must pass.
