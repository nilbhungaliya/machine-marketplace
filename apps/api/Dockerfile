# syntax=docker/dockerfile:1.6
# Build from the REPO ROOT:  docker build -f apps/api/Dockerfile .

# ─── Stage 1: build ────────────────────────────────────────────────────────────
# pnpm 11 needs Node 22. Both stages use one version, so what was built is what runs.
FROM node:22-alpine AS builder

# Must match the pnpm that writes pnpm-lock.yaml (package.json "packageManager").
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate

WORKDIR /repo

# Workspace manifests + lockfile first, for layer caching.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared-types/package.json ./packages/shared-types/

# --ignore-scripts: the root postinstall builds shared-types, whose source isn't copied yet.
RUN pnpm install --frozen-lockfile --filter @mpm/api... --ignore-scripts

COPY packages/shared-types ./packages/shared-types
COPY apps/api ./apps/api
COPY tsconfig.base.json ./

# A ceiling for V8's heap on small build hosts; inert on bigger ones.
ENV NODE_OPTIONS=--max-old-space-size=1536
RUN pnpm --filter @mpm/shared-types build && pnpm --filter @mpm/api build

# Self-contained, production-only copy of the api (workspace deps copied in).
RUN pnpm --filter @mpm/api deploy --prod --legacy /out

# ─── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine

# tini for clean signal handling
RUN apk add --no-cache tini

WORKDIR /app

COPY --from=builder /out/dist ./dist
COPY --from=builder /out/node_modules ./node_modules
COPY --from=builder /out/package.json ./

# Migrations (source of truth) — applied on start by dist/db/migrate.js.
COPY infra/migrations ./migrations
# The pincode directory, read by dist/db/seed-locations.js.
COPY infra/seed ./seed

ENV NODE_ENV=production
ENV PORT=3000
ENV MIGRATIONS_DIR=/app/migrations
ENV SEED_DATA_DIR=/app/seed
EXPOSE 3000

# Apply pending migrations, then start. A failed migration stops the container
# rather than serving against a drifted schema.
ENTRYPOINT ["/sbin/tini", "--"]
# `exec`: node replaces the shell, so tini's SIGTERM reaches it and index.ts shuts down cleanly.
CMD ["sh", "-c", "node dist/db/migrate.js && exec node dist/index.js"]
