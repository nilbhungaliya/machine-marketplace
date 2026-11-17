import { describe, it, expect, vi, beforeEach } from 'vitest';

const captureMock = vi.fn();
const screenMock = vi.fn();
const identifyMock = vi.fn();
const resetMock = vi.fn();
const ctorMock = vi.fn();

vi.mock('posthog-react-native', () => ({
  default: class {
    constructor(token: string, options: Record<string, unknown>) { ctorMock(token, options); }
    capture = captureMock;
    screen = screenMock;
    identify = identifyMock;
    reset = resetMock;
    setPersonProperties = vi.fn();
  },
}));

async function loadModule(token?: string) {
  vi.resetModules();
  // The client is pinned to globalThis (Fast Refresh), so clear it for a fresh one.
  delete (globalThis as { __mpmPostHog?: unknown }).__mpmPostHog;
  if (token) process.env.EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN = token;
  else delete process.env.EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN;
  return import('./analytics');
}

beforeEach(() => {
  [captureMock, screenMock, identifyMock, resetMock, ctorMock].forEach((m) => m.mockClear());
});

describe('without a project token', () => {
  it('never builds a client and every call is a silent no-op', async () => {
    const a = await loadModule(undefined);
    expect(a.initAnalytics()).toBeNull();
    expect(() => a.track(a.AUTH_EVENTS.otpRequested)).not.toThrow();
    expect(() => a.screen('Home')).not.toThrow();
    expect(() => a.identifyUser('u1')).not.toThrow();
    expect(() => a.resetAnalytics()).not.toThrow();
    expect(ctorMock).not.toHaveBeenCalled();
  });
});

describe('with a project token', () => {
  it('builds one client even when the module is evaluated again (Fast Refresh)', async () => {
    const first = await loadModule('phc_test');
    first.initAnalytics();
    vi.resetModules();
    const second = await import('./analytics');
    second.initAnalytics();
    expect(ctorMock).toHaveBeenCalledTimes(1);
  });

  it('drops undefined properties', async () => {
    const a = await loadModule('phc_test');
    a.initAnalytics();
    a.track('x_happened', { kept: 1, gone: undefined });
    expect(captureMock).toHaveBeenCalledWith('x_happened', { kept: 1 });
  });

  it('does not repeat the same screen with the same params', async () => {
    const a = await loadModule('phc_test');
    a.initAnalytics();
    a.screen('ListingDetail', { listingId: 'a' });
    a.screen('ListingDetail', { listingId: 'a' });
    a.screen('ListingDetail', { listingId: 'b' });
    expect(screenMock).toHaveBeenCalledTimes(2);
  });

  it('identifies by id only', async () => {
    const a = await loadModule('phc_test');
    a.initAnalytics();
    a.identifyUser('u1');
    expect(identifyMock).toHaveBeenCalledWith('u1', { mpm_user_id: 'u1' });
  });
});

describe('pickAllowedParams', () => {
  it('keeps only allow-listed primitive params', async () => {
    const a = await loadModule(undefined);
    expect(a.pickAllowedParams({ listingId: 'l1', phone: '+91', price: 5, category: { x: 1 } })).toEqual({ listingId: 'l1' });
    expect(a.pickAllowedParams(undefined)).toEqual({});
  });
});
