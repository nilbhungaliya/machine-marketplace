import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PURGE_CHUNK_SIZE, purgeUrls } from './cdn-purge.js';

// CDN purge (F2 spec §6.1, R45): chunks of 30 URLs, bearer token, `skipped` without a zone, `failed` (never thrown) on a
// bad answer. Against a local fake server, never Cloudflare.

interface Seen {
  method: string;
  url: string;
  authorization: string | undefined;
  body: { files: string[] };
}

let server: Server;
let apiBase = '';
const seen: Seen[] = [];
let answer: (req: IncomingMessage, res: ServerResponse) => void;
const ok = (_req: IncomingMessage, res: ServerResponse) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ success: true, errors: [], result: { id: 'x' } }));
};

const saved: Record<string, string | undefined> = {};
const ENV = ['CLOUDFLARE_ZONE_ID', 'CLOUDFLARE_API_TOKEN'] as const;
const silent = { error: () => undefined };
const urls = (n: number) => Array.from({ length: n }, (_, i) => `https://media.example.test/listings/l/${i}/full.jpg`);

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen.push({ method: req.method!, url: req.url!, authorization: req.headers.authorization, body: JSON.parse(raw || '{}') });
      answer(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  apiBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}/client/v4`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  process.env.CLOUDFLARE_ZONE_ID = 'zone-123';
  process.env.CLOUDFLARE_API_TOKEN = 'test-token';
  seen.length = 0;
  answer = ok;
});

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('purgeUrls', () => {
  it('sends 65 URLs in 3 calls of at most 30, with the bearer token, to the zone', async () => {
    expect(PURGE_CHUNK_SIZE).toBe(30);
    const list = urls(65);
    expect(await purgeUrls(list, { apiBase, log: silent })).toBe('ok');
    expect(seen).toHaveLength(3);
    expect(seen.map((s) => s.body.files.length)).toEqual([30, 30, 5]);
    expect(seen.flatMap((s) => s.body.files)).toEqual(list);
    for (const s of seen) {
      expect(s.method).toBe('POST');
      expect(s.url).toBe('/client/v4/zones/zone-123/purge_cache');
      expect(s.authorization).toBe('Bearer test-token');
    }
  });

  it("is 'skipped' without a zone, and calls nothing", async () => {
    process.env.CLOUDFLARE_ZONE_ID = '';
    expect(await purgeUrls(urls(3), { apiBase, log: silent })).toBe('skipped');
    delete process.env.CLOUDFLARE_ZONE_ID;
    expect(await purgeUrls(urls(3), { apiBase, log: silent })).toBe('skipped');
    expect(seen).toHaveLength(0);
  });

  it("is 'failed', not thrown, on a 500 answer, and still tries the other chunks", async () => {
    const errors: unknown[] = [];
    answer = (_req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: false, errors: [{ code: 1, message: 'boom' }] }));
    };
    expect(await purgeUrls(urls(31), { apiBase, log: { error: (o) => errors.push(o) } })).toBe('failed');
    expect(seen).toHaveLength(2);
    expect(errors).toHaveLength(2);
  });

  it("is 'failed' on a 200 with success: false", async () => {
    answer = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: false, errors: [] }));
    };
    expect(await purgeUrls(urls(1), { apiBase, log: silent })).toBe('failed');
  });

  it("is 'failed' when the server can't be reached", async () => {
    expect(await purgeUrls(urls(1), { apiBase: 'http://127.0.0.1:9/client/v4', log: silent })).toBe('failed');
  });

  it("is 'failed' with a zone but no token, and calls nothing", async () => {
    process.env.CLOUDFLARE_API_TOKEN = '';
    expect(await purgeUrls(urls(1), { apiBase, log: silent })).toBe('failed');
    expect(seen).toHaveLength(0);
  });

  it("de-duplicates URLs and is 'ok' with none to purge", async () => {
    expect(await purgeUrls([], { apiBase, log: silent })).toBe('ok');
    expect(seen).toHaveLength(0);
    expect(await purgeUrls(['https://m.test/a', 'https://m.test/a'], { apiBase, log: silent })).toBe('ok');
    expect(seen[0]!.body.files).toEqual(['https://m.test/a']);
  });
});
