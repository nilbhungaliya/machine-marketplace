import { describe, expect, it } from 'vitest';
import { fonts } from './fonts';
import { TYPE_SCALE, typeStyle, type TypeToken } from './typography';

// The type scale (spec §5.4) and its Hindi / Gujarati rules (spec §5.3).

describe('typeStyle', () => {
  it('returns the English scale as designed', () => {
    expect(typeStyle('title', 'en')).toEqual({
      fontFamily: 'Manrope_700Bold', fontSize: 26, lineHeight: 30, letterSpacing: -0.8,
    });
    expect(typeStyle('body', 'en')).toMatchObject({ fontSize: 15, lineHeight: 22 });
  });

  it('gives Indic scripts a taller line and no negative tracking', () => {
    const hi = typeStyle('title', 'hi');
    expect(hi.lineHeight).toBe(38); // round(26 × 1.45)
    expect(hi.letterSpacing).toBe(0);
    expect(typeStyle('phone', 'gu').letterSpacing).toBe(1); // positive tracking stays
  });

  it('applies the script rules to every non-mono token in Hindi and Gujarati', () => {
    for (const lang of ['hi', 'gu'] as const) {
      for (const [token, entry] of Object.entries(TYPE_SCALE) as [TypeToken, (typeof TYPE_SCALE)[TypeToken]][]) {
        if (entry.family === 'mono' || entry.family === 'monoMedium') continue;
        const style = typeStyle(token, lang);
        expect(style.lineHeight, `${token} ${lang}`).toBeGreaterThanOrEqual(Math.round(entry.size * 1.45));
        expect(style.letterSpacing, `${token} ${lang}`).toBeGreaterThanOrEqual(0);
        expect(style.fontFamily, `${token} ${lang}`).not.toBe(fonts.extraBold);
      }
    }
  });

  it('drops 800 to 700 in Hindi and Gujarati', () => {
    expect(typeStyle('display', 'en').fontFamily).toBe('Manrope_800ExtraBold');
    expect(typeStyle('display', 'gu').fontFamily).toBe('Manrope_700Bold');
    expect(typeStyle('price', 'hi').fontFamily).toBe('Manrope_700Bold');
  });

  it('never changes a mono family by script', () => {
    expect(typeStyle('mono', 'hi').fontFamily).toBe('JetBrainsMono_500Medium');
    expect(typeStyle('mono', 'en').fontFamily).toBe('JetBrainsMono_500Medium');
  });

  it('sets tabular figures only where the scale asks', () => {
    expect(typeStyle('price', 'en').fontVariant).toEqual(['tabular-nums']);
    expect(typeStyle('otp', 'gu').fontVariant).toEqual(['tabular-nums']);
    expect(typeStyle('body', 'en')).not.toHaveProperty('fontVariant');
  });

  it('every token names a loaded font', () => {
    for (const [token, entry] of Object.entries(TYPE_SCALE) as [TypeToken, (typeof TYPE_SCALE)[TypeToken]][]) {
      expect(Object.keys(fonts), token).toContain(entry.family);
    }
  });
});
