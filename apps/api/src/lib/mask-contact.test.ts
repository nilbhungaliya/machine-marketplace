import { describe, expect, it } from 'vitest';
import { maskContact, maskEmails, maskPhones } from './mask-contact.js';

// F6 + F7 §6.5 (R6), plan C0-3: textile's cases plus Indian formats in three scripts.
const M = '••••••••••';

describe('maskPhones', () => {
  it.each([
    ['call 9876543210 now', `call ${M} now`],
    ['+91 98765 43210', M],
    ['+919876543210', M],
    ['91-98765-43210', M],
    ['09876543210', M],
    ['(98765) 43210', M],
    ['98765.43210', M],
    ['98765 - 43210', M],
    ['+91 (98765) 43-210', M],
    ['९८७६५४३२१०', M],
    ['૯૮૭૬૫૪૩૨૧૦', M],
    ['call ९८७६५ ४३२१० please', `call ${M} please`],
  ])('masks %s', (input, want) => {
    expect(maskPhones(input)).toBe(want);
  });

  it.each([
    ['part 123456789012', 'a 12-digit part number'],
    ['GSTIN 24AAACC1206D1ZM', 'a GSTIN'],
    ['5876543210', 'a 10-digit number starting 5'],
    ['qty 25, price 34000', 'small numbers'],
    ['₹8000.00 - 9500.00', 'a decimal price range'],
    ['Qty 1.000 - 2.500 - 3.750', 'decimal quantities'],
  ])('leaves %s alone (%s)', (input) => {
    expect(maskPhones(input)).toBe(input);
  });
});

describe('maskEmails / maskContact', () => {
  it('masks an email', () => {
    expect(maskEmails('mail rahul@gmail.com today')).toBe('mail •••@••• today');
  });
  it('leaves a UPI handle alone (no dot after @)', () => {
    expect(maskContact('pay rocky@okaxis')).toBe('pay rocky@okaxis');
  });
  it('masks an email whose local part is a phone, whole', () => {
    expect(maskContact('9876543210@gmail.com')).toBe('•••@•••');
  });
  it('masks both in one text', () => {
    expect(maskContact('a@b.co or 9876543210')).toBe(`•••@••• or ${M}`);
  });
});
