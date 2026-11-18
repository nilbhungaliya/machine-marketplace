import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, trustProxyHops } from '../src/app.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';

// TRUST_PROXY_HOPS (ported from textile `app.ts`): behind Caddy, `request.ip` must be the client's address, or every
// client shares the per-IP limits (GST lookup / otp-send, spec §5.2). Unset or 0 trusts no proxy, as in dev and tests.

const ENV_KEYS = ['TRUST_PROXY_HOPS', 'GST_IP_RATE_MAX'] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])) as Record<(typeof ENV_KEYS)[number], string | undefined>;

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

/** A random TEST-NET-2 address (198.51.100.0/24), fresh per call so counts from other runs never leak in. */
const randomIp = () => `198.51.100.${Math.floor(Math.random() * 254) + 1}`;

describe('trustProxyHops', () => {
  afterEach(restoreEnv);

  it('unset, empty or 0 → false (trust nothing)', () => {
    delete process.env.TRUST_PROXY_HOPS;
    expect(trustProxyHops()).toBe(false);
    process.env.TRUST_PROXY_HOPS = '';
    expect(trustProxyHops()).toBe(false);
    process.env.TRUST_PROXY_HOPS = '0';
    expect(trustProxyHops()).toBe(false);
  });

  it('a whole number of proxies → that number', () => {
    process.env.TRUST_PROXY_HOPS = '1';
    expect(trustProxyHops()).toBe(1);
    process.env.TRUST_PROXY_HOPS = '2';
    expect(trustProxyHops()).toBe(2);
  });

  it('a malformed value stops the start', async () => {
    for (const bad of ['-1', '1.5', 'abc', 'true']) {
      process.env.TRUST_PROXY_HOPS = bad;
      expect(() => trustProxyHops()).toThrow(/TRUST_PROXY_HOPS/);
    }
    process.env.TRUST_PROXY_HOPS = 'abc';
    await expect(buildApp({ infra: false, logger: false })).rejects.toThrow(/TRUST_PROXY_HOPS/);
  });
});

describe('per-IP GST limit behind a proxy (TRUST_PROXY_HOPS=1)', () => {
  const CADDY = '172.18.0.9';
  let app: FastifyInstance;
  let user: TestBusinessUser;
  const ip1 = randomIp();
  let ip2 = randomIp();
  while (ip2 === ip1) ip2 = randomIp();
  const keys = [`rl:gst-ip:lookup:${ip1}`, `rl:gst-ip:lookup:${ip2}`, `rl:gst-ip:lookup:${CADDY}`];

  // One app per file: closing it ends the shared pg pool. trustProxy is fixed when the app is built, so the env is
  // set first. The "unset" case (headers ignored) is covered in gst-instant.test.ts, whose app trusts no proxy.
  beforeAll(async () => {
    process.env.TRUST_PROXY_HOPS = '1';
    process.env.GST_IP_RATE_MAX = '2';
    app = await buildApp({ logger: false });
    user = await createTestBusinessUser();
    await app.redis!.del(...keys);
  });

  afterAll(async () => {
    await app.redis!.del(...keys);
    await deleteTestBusinesses([user.businessId]);
    await app.close();
    restoreEnv();
  });

  const lookupFrom = (forwardedFor: string) =>
    app.inject({
      method: 'POST',
      url: '/businesses/me/gst/lookup',
      remoteAddress: CADDY,
      headers: { authorization: `Bearer ${user.token}`, 'x-forwarded-for': forwardedFor },
      payload: { gstin: 'NOT-A-GSTIN' },
    });

  it('two forwarded client IPs from one proxy address get separate counters', async () => {
    process.env.GST_IP_RATE_MAX = '2';
    expect((await lookupFrom(ip1)).statusCode).toBe(400);
    expect((await lookupFrom(ip1)).statusCode).toBe(400);
    const third = await lookupFrom(ip1);
    expect(third.statusCode).toBe(429);
    expect(third.json().code).toBe('RATE_LIMITED');
    // Another client behind the same proxy has its own count.
    expect((await lookupFrom(ip2)).statusCode).toBe(400);
    expect(await app.redis!.get(`rl:gst-ip:lookup:${ip1}`)).toBe('3');
    expect(await app.redis!.get(`rl:gst-ip:lookup:${ip2}`)).toBe('1');
    expect(await app.redis!.exists(`rl:gst-ip:lookup:${CADDY}`)).toBe(0);
  });

  it('only the last hop is trusted: a client-sent address before the proxy entry is ignored', async () => {
    process.env.GST_IP_RATE_MAX = '2';
    // "forged, ip2" as Caddy would forward it if a client sent its own header: the client is ip2 (already at 1).
    expect((await lookupFrom(`203.0.113.7, ${ip2}`)).statusCode).toBe(400);
    expect(await app.redis!.get(`rl:gst-ip:lookup:${ip2}`)).toBe('2');
  });
});
