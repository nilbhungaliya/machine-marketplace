# Production deployment (API)

Target per the product scope: **AWS Mumbai (`ap-south-1`)** for data residency and latency.
This kit follows the layout the ORA project runs in production.

| Piece | Where |
|---|---|
| API + Redis + Caddy (auto-HTTPS, proxies Socket.IO) | one EC2 box via `docker compose` (this folder) |
| PostgreSQL 18 + PostGIS | a separate private box or RDS; only the API's security group may reach 5432 |
| Media (part / machine photos and videos, documents) | S3 bucket in `ap-south-1` |

## First deploy
1. Point the API domain's DNS A record at the app server's Elastic IP; put that domain in `Caddyfile`.
2. On the server: install Docker, clone the repo, then `cp .env.example infra/deploy/.env` and fill it
   (`DATABASE_URL` → the DB box, strong `JWT_*` secrets, `NODE_ENV=production`, provider keys).
3. `cd infra/deploy && docker compose up -d --build`. The api container applies pending
   migrations (`infra/migrations`) before it starts; a failed migration keeps it down.
4. Seed the first admin once: `docker compose exec api node dist/db/seed.js`.

## Updates
`HEALTH_URL=https://<api-domain>/health ./infra/deploy/deploy.sh` — pull, rebuild, restart, wait for health.

## You own (no managed service does it for you)
- **Backups** of the Postgres box (daily + point-in-time per the scope's NFRs) — set these up before launch.
- Postgres minor-version upgrades, OS patching, a billing alert.

`infra/deploy/.env` is git-ignored and must never be committed or baked into an image.
