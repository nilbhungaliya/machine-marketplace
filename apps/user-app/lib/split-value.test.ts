import { describe, expect, it } from 'vitest';
import { splitOnValue } from './split-value';

// A translated sentence split around an interpolated value, so the value alone can be set in mono (spec §5.2, §7.6).

describe('splitOnValue', () => {
  const gstin = '24AAKFS4821M1Z6';

  it('splits a value at the end', () => {
    expect(splitOnValue(`GSTIN: ${gstin}`, gstin)).toEqual(['GSTIN: ', gstin, '']);
  });

  it('splits a value in the middle of a Gujarati sentence', () => {
    expect(splitOnValue(`તમારો GSTIN ${gstin} ચકાસાયેલ છે`, gstin)).toEqual(['તમારો GSTIN ', gstin, ' ચકાસાયેલ છે']);
  });

  it('splits at the first occurrence', () => {
    expect(splitOnValue(`${gstin} / ${gstin}`, gstin)).toEqual(['', gstin, ` / ${gstin}`]);
  });

  it('returns null when the value is absent or empty', () => {
    expect(splitOnValue('GSTIN: —', gstin)).toBeNull();
    expect(splitOnValue('GSTIN: ', '')).toBeNull();
  });
});
