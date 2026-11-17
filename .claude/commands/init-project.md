# Initialize Project

Run the following commands to set up and start the project locally.

## 1. Create environment files
```bash
cp .env.example .env
cp apps/admin/.env.example apps/admin/.env.local
cp apps/user-app/.env.example apps/user-app/.env
```

## 2. Install dependencies
```bash
pnpm install
```
Installs every workspace (apps/*, packages/*) from the repo root.

## 3. Start infrastructure
```bash
pnpm infra:up
```
Starts PostgreSQL 16 + PostGIS, Redis 7 and Meilisearch via `infra/docker-compose.yml`.

## 4. Database
```bash
pnpm --filter @mpm/api db:migrate
pnpm --filter @mpm/api db:seed
```
Applies Drizzle migrations from `infra/migrations/` and seeds the first super admin
(`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from `.env`).

## 5. Run the apps
```bash
pnpm dev:api          # Fastify API      → http://localhost:3000 (docs at /docs)
pnpm dev:admin        # Next.js admin    → http://localhost:3001
pnpm start:user       # Expo user app    → Metro on port 8082
```

## 6. Validate
```bash
pnpm typecheck && pnpm lint && pnpm test
```
