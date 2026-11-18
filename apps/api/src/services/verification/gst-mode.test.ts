import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getGstMode } from './gst-mode.js';
import { getGstProvider, resetGstProvider, setGstProvider, type GstLookup, type GstProvider } from './gst-provider.js';
import { gstStub } from './gst-stub.js';

// GST mode (F1 + A2 spec §5.1): live = adapter registered AND GST_API_KEY set; stub = not production and GST_PROVIDER
// unset/empty/`stub`; review = everything else. getGstProvider() follows the mode.

const KEYS = ['NODE_ENV', 'GST_PROVIDER', 'GST_API_KEY'] as const;
let saved: Record<(typeof KEYS)[number], string | undefined>;

function env(values: Partial<Record<(typeof KEYS)[number], string>>): void {
  for (const key of KEYS) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
}

function spyProvider() {
  return {
    lookup: vi.fn<[string], Promise<GstLookup>>(async () => ({ kind: 'not_found' })),
    sendContactOtp: vi.fn(async () => ({ ref: 'r', hint: 'h' })),
    verifyContactOtp: vi.fn(async () => true),
  } satisfies GstProvider;
}

beforeEach(() => {
  saved = { NODE_ENV: process.env.NODE_ENV, GST_PROVIDER: process.env.GST_PROVIDER, GST_API_KEY: process.env.GST_API_KEY };
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  resetGstProvider();
});

describe('getGstMode', () => {
  it('no provider, NODE_ENV=test, no GST_PROVIDER → stub', () => {
    env({ NODE_ENV: 'test' });
    expect(getGstMode()).toBe('stub');
    expect(getGstProvider()).toBe(gstStub);
  });

  it('GST_PROVIDER empty or `stub` outside production → stub', () => {
    env({ NODE_ENV: 'development', GST_PROVIDER: '' });
    expect(getGstMode()).toBe('stub');
    env({ NODE_ENV: 'development', GST_PROVIDER: 'stub' });
    expect(getGstMode()).toBe('stub');
  });

  it('GST_PROVIDER=off → review', () => {
    env({ NODE_ENV: 'test', GST_PROVIDER: 'off' });
    expect(getGstMode()).toBe('review');
  });

  it('GST_PROVIDER naming a provider without an adapter or key → review', () => {
    env({ NODE_ENV: 'test', GST_PROVIDER: 'acme' });
    expect(getGstMode()).toBe('review');
    env({ NODE_ENV: 'test', GST_PROVIDER: 'acme', GST_API_KEY: 'k' });
    expect(getGstMode()).toBe('review');
  });

  it('production never runs the stub, whatever GST_PROVIDER says', () => {
    env({ NODE_ENV: 'production', GST_PROVIDER: 'stub' });
    expect(getGstMode()).toBe('review');
    env({ NODE_ENV: 'production' });
    expect(getGstMode()).toBe('review');
  });

  it('registered provider + key → live, and getGstProvider() is the registered one', () => {
    const p = spyProvider();
    setGstProvider(p);
    env({ NODE_ENV: 'production', GST_API_KEY: 'secret' });
    expect(getGstMode()).toBe('live');
    expect(getGstProvider()).toBe(p);
    env({ NODE_ENV: 'test', GST_API_KEY: 'secret' });
    expect(getGstMode()).toBe('live');
  });

  it('a blank key does not count as set', () => {
    setGstProvider(spyProvider());
    env({ NODE_ENV: 'production', GST_API_KEY: '   ' });
    expect(getGstMode()).toBe('review');
  });

  it('registered provider, no key, NODE_ENV=test, GST_PROVIDER unset → stub, and the real provider is never called', async () => {
    const p = spyProvider();
    setGstProvider(p);
    env({ NODE_ENV: 'test' });
    expect(getGstMode()).toBe('stub');
    const provider = getGstProvider();
    expect(provider).toBe(gstStub);
    await provider.lookup('27AAPFU0939F1ZV');
    expect(p.lookup).not.toHaveBeenCalled();
  });

  it('registered provider, no key, GST_PROVIDER=acme → review', () => {
    setGstProvider(spyProvider());
    env({ NODE_ENV: 'test', GST_PROVIDER: 'acme' });
    expect(getGstMode()).toBe('review');
  });

  it('registered provider, no key, production → review', () => {
    setGstProvider(spyProvider());
    env({ NODE_ENV: 'production' });
    expect(getGstMode()).toBe('review');
  });

  it('review mode: lookup and code-send reject with 503 GST_UNAVAILABLE; verify is false', async () => {
    const p = spyProvider();
    setGstProvider(p);
    env({ NODE_ENV: 'production' });
    const provider = getGstProvider();
    await expect(provider.lookup('27AAPFU0939F1ZV')).rejects.toMatchObject({ statusCode: 503, code: 'GST_UNAVAILABLE' });
    await expect(provider.sendContactOtp('27AAPFU0939F1ZV')).rejects.toMatchObject({ statusCode: 503, code: 'GST_UNAVAILABLE' });
    expect(await provider.verifyContactOtp('ref', '123456')).toBe(false);
    expect(p.lookup).not.toHaveBeenCalled();
  });
});
