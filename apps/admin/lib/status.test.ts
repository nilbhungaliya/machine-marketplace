import { describe, expect, it } from 'vitest';
import { statusTone } from './status';

describe('statusTone', () => {
  it('a GST review waiting for more files is amber, as the app’s orange "Needs more" chip', () => {
    expect(statusTone('needs_more')).toBe('amber');
    expect(statusTone('waiting')).toBe('amber');
    expect(statusTone('pending')).toBe('amber');
  });

  it('decided reviews: approved green, rejected red; unknown gray', () => {
    expect(statusTone('approved')).toBe('green');
    expect(statusTone('rejected')).toBe('red');
    expect(statusTone('something_new')).toBe('gray');
  });
});
