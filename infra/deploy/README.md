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
   (`DATABASE_URL` → the DB box, strong `JWT_*` secrets, `DISCOVERY_CURSOR_SECRET` (at least 32 characters; required,
   the API refuses to start without it), `NODE_ENV=production`, provider keys).
3. `cd infra/deploy && docker compose up -d --build`. The api container applies pending
   migrations (`infra/migrations`) before it starts; a failed migration keeps it down.
4. Seed the first admin once: `docker compose exec api node dist/db/seed.js`.

## Updates
`HEALTH_URL=https://<api-domain>/health ./infra/deploy/deploy.sh` — pull, rebuild, restart, wait for health.

## Client IPs behind Caddy
`docker-compose.yml` sets `TRUST_PROXY_HOPS=1`, because Caddy is the only proxy in front of the API. Per-IP rate limits
(e.g. the GST lookup and code-send limits, `GST_IP_RATE_MAX`) key on `request.ip`, so without it every client would have
Caddy's address and share one bucket. The API logs `trusted proxy hops resolved` with the count on start. This relies on
two things: Caddy ignores a client-sent `X-Forwarded-For` by default (no `trusted_proxies` is set in the `Caddyfile`),
and the API publishes no port, so only Caddy can reach it. **If a CDN or load balancer goes in front of Caddy,**
configure Caddy's `trusted_proxies` for it and raise `TRUST_PROXY_HOPS` to 2; Caddy then keeps the CDN's header and
appends to it. Two wrong counts fail differently:
- **Too few** (a CDN with hops left at 1): `request.ip` is the CDN's address, so clients merge into shared rate-limit
  buckets. Nothing can be forged.
- **Too many** (more hops than real proxies, while Caddy keeps incoming headers): `request.ip` comes from a value the
  client sent, so a client can forge its address and escape its rate limit.

## You own (no managed service does it for you)
- **Backups** of the Postgres box (daily + point-in-time per the scope's NFRs) — set these up before launch.
- Postgres minor-version upgrades, OS patching, a billing alert.

`infra/deploy/.env` is git-ignored and must never be committed or baked into an image.
