# Changelog

All notable changes to this project. Newest first. Reference scope modules (U1–U4, F1–F9, A1–A6) where relevant.

## [Unreleased] — Research, feature spec and design

### Docs
- `docs/product-scope.md`: full feature specification (M1–M20, admin AD1–AD7), mapped to the PDF's U/F/A IDs, with
  release phases, competitor inspiration, business model and client decisions; includes buyer requirements (RFQ) with capped
  seller matching, replies with a listing or quote, and availability alerts (M11).
- `docs/research/`: sourced competitor notes (Fibre2Fashion Machinery; Exapro, Machinio, Kitmondo, Surplus Record, Mascus,
  MachineryTrader, eBay, Alibaba; IndiaMART, TradeIndia, Machineseeker, rental platforms, parts-fitment sites).
- `docs/mockups/user-app-mockup.html` + `src/build.mjs` + README: app and admin design for client review.

## [Unreleased] — Base setup

Ported from the Textile Stock Marketplace base (itself from ORA) and adapted to the machine-parts scope.

### Monorepo
- pnpm 11 workspace (Node 22+): `apps/api`, `apps/user-app`, `apps/admin`, `packages/shared-types`.
- `.claude/` shared commands, skills (incl. `frontend-design`) and plugins (incl. Superpowers); `CLAUDE.md` per app.
- `infra/docker-compose.yml` for local Postgres 18 + PostGIS (:5434) and Redis (:6381), test DB created on first start;
  `infra/deploy/` production kit (API + Redis + Caddy) and `apps/api/Dockerfile` (migrations applied on container start).

### Shared types
- Listing kinds (part / machine / machine rental) and statuses, conditions (New / Used / Unused / Excess),
  Left / Right / Pair sides with `complementarySide()`, units, price models, rental periods (F2, F3, F7).
- Enquiry, offer, deal, rental booking, part request and report statuses; quick enquiries; notification types (F6–F9, A6).

### API (`apps/api`)
- Fastify 4 + Drizzle + Zod; central `{ error, code }` error handler; Redis-backed rate limits (`RATE_LIMIT_MAX`).
- Auth: admin email + password (bcrypt, JWT, 6 roles); phone OTP for users (dev mode returns the code;
  MSG91 delivery pending) with stable error codes; suspended / blocked accounts refused (`ACCOUNT_SUSPENDED`, A2).
- `PATCH /users/me` onboarding creates the user's business.
- Socket.IO `/user` and `/admin` namespaces with JWT handshake auth and named rooms.
- In-process job runner (`src/jobs/`) with graceful shutdown; Sentry (opt-in) with PII scrubbing; money helpers.
- Tests refuse to run without a separate `*_test` database.
- Initial migrations: PostGIS + pg_trgm; `admin_users`, `businesses` (GST, location, industrial area, verification), `users`, `audit_log`.

### User app (`apps/user-app`)
- Expo 54 / RN 0.81, React Navigation, Redux Toolkit, React Query, Formik + Yup, Reanimated 4.
- English / Hindi / Gujarati with parity and hard-coded-English audit tests; IST date formatting.
- Welcome → phone OTP → onboarding → five tabs (Home, Search, Post, Chats, Deals) + Profile.
- Post offers: sell a part, sell a machine, rent out a machine, request a part (placeholders).

### Admin (`apps/admin`)
- Next 14 + Tailwind + RHF/Zod + sonner; role-filtered sidebar for every scope admin module (A1–A6), dashboard KPI tiles.
- Dialog, confirm, form dialog, tabs, data table with sorting and pagination, filter kit,
  image lightbox, URL state, arrow-key navigation, admin socket client.
