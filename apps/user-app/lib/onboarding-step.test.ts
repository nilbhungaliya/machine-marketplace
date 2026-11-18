import { beforeEach, describe, expect, it, vi } from 'vitest';

// AsyncStorage is a native module: an in-memory stand-in, switchable to throwing.
const store = new Map<string, string>();
let broken = false;
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => {
      if (broken) throw new Error('storage down');
      return store.get(k) ?? null;
    }),
    setItem: vi.fn(async (k: string, v: string) => {
      if (broken) throw new Error('storage down');
      store.set(k, v);
    }),
    removeItem: vi.fn(async (k: string) => {
      if (broken) throw new Error('storage down');
      store.delete(k);
    }),
  },
}));

import {
  buildLocationSchema,
  buildProfileSchema,
  cachedStep,
  cacheStep,
  hasSeenGstIntro,
  markGstIntroSeen,
  appEntry,
  nextScreen,
  shouldShowGstIntro,
  stepAfterBootError,
  toLocationBody,
  toProfileBody,
  type ProfileFormValues,
} from './onboarding-step';

const t = (key: string) => key;

beforeEach(() => {
  store.clear();
  broken = false;
});

describe('nextScreen', () => {
  it('maps each onboarding step to its screen', () => {
    expect(nextScreen('profile')).toBe('YourBusiness');
    expect(nextScreen('location')).toBe('WhereAreYou');
    expect(nextScreen('done')).toBe('Main');
  });
});

describe('location schema', () => {
  const schema = buildLocationSchema(t);
  const base = { pincode: '395010', city: 'Surat', state: 'Gujarat', industrialAreaId: 'a1', industrialAreaOther: '', addressLine: '' };

  it('accepts a 6-digit pincode that does not start with 0', () => {
    expect(schema.isValidSync(base)).toBe(true);
    expect(schema.isValidSync({ ...base, pincode: '012345' })).toBe(false);
    expect(schema.isValidSync({ ...base, pincode: '39501' })).toBe(false);
  });

  it('reads Gujarati and Hindi digits in the pincode', () => {
    expect(schema.isValidSync({ ...base, pincode: '૩૯૫૦૧૦' })).toBe(true);
  });

  it('needs city and state', () => {
    expect(schema.isValidSync({ ...base, city: ' ' })).toBe(false);
    expect(schema.isValidSync({ ...base, state: '' })).toBe(false);
  });

  it('needs exactly one of a listed area and Other', () => {
    expect(schema.isValidSync({ ...base, industrialAreaId: null, industrialAreaOther: 'Bhatar Road' })).toBe(true);
    expect(schema.isValidSync({ ...base, industrialAreaId: 'a1', industrialAreaOther: 'Bhatar Road' })).toBe(false);
    expect(schema.isValidSync({ ...base, industrialAreaId: null, industrialAreaOther: '' })).toBe(false);
  });

  it('puts the area error on the industrial area field', () => {
    try {
      schema.validateSync({ ...base, industrialAreaId: null, industrialAreaOther: '' }, { abortEarly: false });
      expect.unreachable();
    } catch (err) {
      expect((err as { inner: { path: string }[] }).inner.map((e) => e.path)).toContain('industrialAreaId');
    }
  });

  it('Other needs 2 to 80 characters', () => {
    expect(schema.isValidSync({ ...base, industrialAreaId: null, industrialAreaOther: 'X' })).toBe(false);
  });
});

describe('toLocationBody', () => {
  it('sends ASCII digits, one area field, nulls for blanks and the pin when there is one', () => {
    expect(
      toLocationBody(
        { pincode: '૩૯૫૦૧૦', city: ' Surat ', state: 'Gujarat', industrialAreaId: 'a1', industrialAreaOther: '', addressLine: ' ' },
        { lat: 21.17, lng: 72.83 },
      ),
    ).toEqual({
      pincode: '395010', city: 'Surat', state: 'Gujarat', industrialAreaId: 'a1', industrialAreaOther: null, addressLine: null,
      lat: 21.17, lng: 72.83,
    });
    expect(
      toLocationBody({ pincode: '395010', city: 'Surat', state: 'Gujarat', industrialAreaId: null, industrialAreaOther: ' Bhatar ', addressLine: 'Plot 4' }, null),
    ).toEqual({ pincode: '395010', city: 'Surat', state: 'Gujarat', industrialAreaId: null, industrialAreaOther: 'Bhatar', addressLine: 'Plot 4' });
  });
});

describe('profile schema and body', () => {
  const base: ProfileFormValues = {
    name: 'Hitesh Patel', businessName: 'Shree Ambica', activities: ['buy'], categories: ['c1'], email: '', yearEstablished: '', employees: null,
  };

  it('needs names, an activity and a machine category', () => {
    const schema = buildProfileSchema(t);
    expect(schema.isValidSync(base)).toBe(true);
    expect(schema.isValidSync({ ...base, name: 'H' })).toBe(false);
    expect(schema.isValidSync({ ...base, activities: [] })).toBe(false);
    expect(schema.isValidSync({ ...base, categories: [] })).toBe(false);
  });

  it('checks the optional email and year', () => {
    const schema = buildProfileSchema(t);
    expect(schema.isValidSync({ ...base, email: 'not-an-email' })).toBe(false);
    expect(schema.isValidSync({ ...base, yearEstablished: '1899' })).toBe(false);
    expect(schema.isValidSync({ ...base, yearEstablished: '૨૦૧૧' })).toBe(true);
  });

  it('leaves out the business name while it is locked, and the optional fields during onboarding', () => {
    expect(toProfileBody(base, { nameLocked: true, mode: 'onboarding' })).toEqual({
      name: 'Hitesh Patel', activities: ['buy'], categories: ['c1'],
    });
    expect(toProfileBody({ ...base, email: ' a@b.in ', yearEstablished: '2011', employees: '11-50' }, { nameLocked: false, mode: 'edit' })).toEqual({
      name: 'Hitesh Patel', businessName: 'Shree Ambica', activities: ['buy'], categories: ['c1'],
      email: 'a@b.in', yearEstablished: 2011, employees: '11-50',
    });
    expect(toProfileBody(base, { nameLocked: false, mode: 'edit' })).toMatchObject({ email: null, yearEstablished: null, employees: null });
  });
});

describe('GST intro, once per device and user', () => {
  it('is unseen for a new user id, seen after marking', async () => {
    expect(await hasSeenGstIntro('u1')).toBe(false);
    await markGstIntroSeen('u1');
    expect(await hasSeenGstIntro('u1')).toBe(true);
    expect(await hasSeenGstIntro('u2')).toBe(false);
    expect(store.has('gst_intro_seen:u1')).toBe(true);
  });

  it('counts as seen when storage throws, and marking never throws', async () => {
    broken = true;
    expect(await hasSeenGstIntro('u3')).toBe(true);
    await expect(markGstIntroSeen('u3')).resolves.toBeUndefined();
  });

  it('shows only once onboarding is done, GST is not verified and it was not seen', () => {
    expect(shouldShowGstIntro({ step: 'done', gstVerified: false, seen: false })).toBe(true);
    expect(shouldShowGstIntro({ step: 'done', gstVerified: true, seen: false })).toBe(false);
    expect(shouldShowGstIntro({ step: 'done', gstVerified: false, seen: true })).toBe(false);
    expect(shouldShowGstIntro({ step: 'location', gstVerified: false, seen: false })).toBe(false);
  });
});

describe('appEntry: the first screen of the signed-in app', () => {
  it('is the GST intro while it is due, else the tabs', () => {
    expect(appEntry(true)).toEqual({ screen: 'GstIntro' });
    expect(appEntry(false)).toEqual({ screen: 'Main' });
  });
});

describe('cold start', () => {
  it('signs out on 401 and a suspended account, starts onboarding without a business, else uses the last known step', () => {
    expect(stepAfterBootError({ status: 401 }, 'done')).toBe('signed_out');
    expect(stepAfterBootError({ status: 403, code: 'ACCOUNT_SUSPENDED' }, 'done')).toBe('signed_out');
    expect(stepAfterBootError({ status: 404, code: 'NO_BUSINESS' }, 'done')).toBe('profile');
    expect(stepAfterBootError({ code: 'ERR_NETWORK' }, 'location')).toBe('location');
    // Offline with nothing cached: start at the first step rather than skip onboarding.
    expect(stepAfterBootError({ code: 'ERR_NETWORK' }, null)).toBe('profile');
  });

  it('remembers the last step per user', async () => {
    expect(await cachedStep('u1')).toBeNull();
    await cacheStep('u1', 'location');
    expect(await cachedStep('u1')).toBe('location');
    store.set('onboarding_step:u1', 'garbage');
    expect(await cachedStep('u1')).toBeNull();
    broken = true;
    expect(await cachedStep('u1')).toBeNull();
    await expect(cacheStep('u1', 'done')).resolves.toBeUndefined();
  });
});
