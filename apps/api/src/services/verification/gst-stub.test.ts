import { afterEach, describe, expect, it } from 'vitest';
import { isValidGstin } from '@mpm/shared-types';
import {
  STUB_GSTIN_CANCELLED,
  STUB_GSTIN_NOT_FOUND,
  STUB_GSTIN_UNAVAILABLE,
  gstStub,
  resetStubGstins,
  setStubGstin,
  stubSentCodes,
} from './gst-stub.js';
import { parseGstin } from './gstin.js';

// The dev GST provider (F1 + A2 spec §5.1) and GSTIN parsing (§5.2 step 1).

const VALID = '27AAPFU0939F1ZV';

afterEach(() => resetStubGstins());

describe('gstStub', () => {
  it('the fixed GSTINs have valid checksums', () => {
    for (const g of [STUB_GSTIN_CANCELLED, STUB_GSTIN_NOT_FOUND, STUB_GSTIN_UNAVAILABLE, VALID]) expect(isValidGstin(g)).toBe(true);
  });

  it('a valid GSTIN is found, active, with details built from it', async () => {
    const res = await gstStub.lookup(VALID);
    expect(res.kind).toBe('found');
    if (res.kind !== 'found') return;
    expect(res.ref).toContain(VALID);
    expect(res.details.status).toBe('active');
    expect(res.details.legalName).toContain('AAPFU0939F'); // the PAN
    expect(res.details.address).toMatchObject({ city: expect.any(String), state: expect.any(String) });
    expect(res.details.address.pincode).toMatch(/^[1-9]\d{5}$/);
    expect(res.details.constitution).toBeTruthy();
    const other = await gstStub.lookup('24AAACC1206D1ZM');
    expect(other.kind === 'found' && other.details.legalName).not.toBe(res.details.legalName);
  });

  it('the three fixed GSTINs: cancelled, not found, unavailable', async () => {
    const cancelled = await gstStub.lookup(STUB_GSTIN_CANCELLED);
    expect(cancelled.kind === 'found' && cancelled.details.status).toBe('cancelled');
    expect(await gstStub.lookup(STUB_GSTIN_NOT_FOUND)).toEqual({ kind: 'not_found' });
    expect(await gstStub.lookup(STUB_GSTIN_UNAVAILABLE)).toEqual({ kind: 'unavailable' });
  });

  it('setStubGstin overrides an outcome until reset', async () => {
    setStubGstin(VALID, 'suspended');
    const res = await gstStub.lookup(VALID);
    expect(res.kind === 'found' && res.details.status).toBe('suspended');
    setStubGstin(STUB_GSTIN_UNAVAILABLE, 'active');
    expect((await gstStub.lookup(STUB_GSTIN_UNAVAILABLE)).kind).toBe('found');
    setStubGstin(VALID, null);
    const back = await gstStub.lookup(VALID);
    expect(back.kind === 'found' && back.details.status).toBe('active');
    resetStubGstins();
    expect((await gstStub.lookup(STUB_GSTIN_UNAVAILABLE)).kind).toBe('unavailable');
  });

  it('sends a code with the fixed hint and records the GSTIN; reset clears the record', async () => {
    expect(stubSentCodes()).toEqual([]);
    expect(await gstStub.sendContactOtp(VALID)).toEqual({ ref: expect.any(String), hint: '98•••••36' });
    expect(await gstStub.sendContactOtp(VALID)).toMatchObject({ hint: '98•••••36' });
    expect(stubSentCodes()).toEqual([VALID, VALID]);
    resetStubGstins();
    expect(stubSentCodes()).toEqual([]);
  });

  it('code-send to an unavailable GSTIN answers unavailable', async () => {
    expect(await gstStub.sendContactOtp(STUB_GSTIN_UNAVAILABLE)).toEqual({ kind: 'unavailable' });
  });

  it('verifyContactOtp: 123456 is right, anything else is wrong', async () => {
    const sent = await gstStub.sendContactOtp(VALID);
    const ref = 'ref' in sent ? sent.ref : '';
    expect(await gstStub.verifyContactOtp(ref, '123456')).toBe(true);
    expect(await gstStub.verifyContactOtp(ref, '654321')).toBe(false);
    expect(await gstStub.verifyContactOtp(ref, '')).toBe(false);
  });
});

describe('parseGstin', () => {
  it('normalises spaces and case', () => {
    expect(parseGstin(' 27aapfu 0939f1zv ')).toBe(VALID);
  });

  it('rejects a bad checksum, a bad format and an empty string with 400 GSTIN_INVALID', () => {
    for (const bad of ['27AAPFU0939F1ZW', '27AAPFU0939F1Z', 'ABCDEFGHIJKLMNO', '']) {
      expect(() => parseGstin(bad)).toThrow(expect.objectContaining({ statusCode: 400, code: 'GSTIN_INVALID', message: 'Enter a valid 15-character GSTIN' }));
    }
  });
});
