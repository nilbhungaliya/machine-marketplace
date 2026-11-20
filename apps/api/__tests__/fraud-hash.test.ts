import { describe, expect, it } from 'vitest';
import { findPhones } from '../src/lib/mask-contact.js';
import { looksLikeScam, paymentDetailKinds } from '../src/services/chat/scam-patterns.js';
import { hmacPhone } from '../src/services/fraud/hash.js';

// Admin close-out A3-1 (§8.1, R10): the detectors and the phone HMAC behind the fraud signals.

const KEY_A = 'test-signal-hash-key-a-0123456789abcdef';
const KEY_B = 'test-signal-hash-key-b-0123456789abcdef';

describe('findPhones', () => {
  it('reads ASCII and Devanagari forms of one number as the same last 10 digits', () => {
    expect(findPhones('call +91 98765 43210 or ९८७६५४३२१०')).toEqual(['9876543210']);
  });

  it('finds nothing in part numbers or a GSTIN', () => {
    expect(findPhones('part 6205-2RS, GSTIN 24AAACC0000C1ZY')).toEqual([]);
  });
});

describe('paymentDetailKinds', () => {
  it.each([
    ['IFSC HDFC0001234', ['bank_details']],
    ['A/c no 123456789012', ['bank_details']],
    ['account number 12345678', []],
    ['pay to shop@okaxis', ['upi_handle']],
    ['advance bhejo', ['advance_ask']],
  ])('%s → %j', (text, kinds) => {
    expect(paymentDetailKinds(text)).toEqual(kinds);
  });

  it('leaves the scam warning unchanged for bank details', () => {
    expect(looksLikeScam('IFSC HDFC0001234')).toBe(false);
  });
});

describe('hmacPhone', () => {
  it('is the same for a spaced and a Devanagari-digit form, and differs under another key', () => {
    const spaced = hmacPhone('98765 43210', KEY_A);
    expect(hmacPhone('९८७६५४३२१०', KEY_A)).toBe(spaced);
    expect(hmacPhone('98765 43210', KEY_B)).not.toBe(spaced);
    expect(spaced).toMatch(/^[0-9a-f]{64}$/);
  });
});
