import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { NOT_PORTED, TOKEN_SOURCE, darkColors, lightColors, shadowValues, type ThemeColors } from './palette';

// Palette parity (spec §11.1): every app token equals the approved mockup's CSS variable, in both themes.

const MOCKUP = path.resolve(__dirname, '../../../docs/mockups/src/build-periwinkle-v2.mjs');

/** Every `:root{…}` and `[data-theme="dark"]{…}` block in file order; later blocks win, as in CSS. */
function readMockupTokens(): { light: Record<string, string>; dark: Record<string, string> } {
  const source = readFileSync(MOCKUP, 'utf8');
  const light: Record<string, string> = {};
  const dark: Record<string, string> = {};
  const block = /(:root|\[data-theme="dark"\])\{([^}]*)\}/g;
  for (const m of source.matchAll(block)) {
    const target = m[1] === ':root' ? light : dark;
    for (const decl of m[2].split(';')) {
      const colon = decl.indexOf(':');
      if (colon < 0) continue;
      const name = decl.slice(0, colon).trim();
      if (!name.startsWith('--')) continue;
      target[name.slice(2)] = decl.slice(colon + 1).trim();
    }
  }
  return { light, dark };
}

const norm = (v: string) => v.toLowerCase().replace(/\s+/g, '').replace(/(^|[^0-9])0\./g, '$1.');

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255).map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const mockup = readMockupTokens();
const themes: [string, ThemeColors, Record<string, string>][] = [
  ['light', lightColors, mockup.light],
  ['dark', darkColors, mockup.dark],
];

describe('palette parity with the Periwinkle v2 mockup', () => {
  it('reads the mockup tokens', () => {
    expect(mockup.light.canvas).toBe('#F5F4FA');
    expect(mockup.dark.field).toBe('#232038');
  });

  for (const [theme, colors, vars] of themes) {
    it(`every mapped token equals the mockup (${theme})`, () => {
      for (const [token, varName] of Object.entries(TOKEN_SOURCE) as [keyof ThemeColors, string][]) {
        expect(vars[varName], `--${varName} missing in the ${theme} mockup`).toBeDefined();
        expect(norm(colors[token]), `${token} (--${varName}, ${theme})`).toBe(norm(vars[varName]));
      }
    });
  }

  it('maps or deliberately skips every mockup variable', () => {
    const known = new Set<string>([...Object.values(TOKEN_SOURCE), ...NOT_PORTED]);
    const names = new Set([...Object.keys(mockup.light), ...Object.keys(mockup.dark)]);
    expect([...names].filter((n) => !known.has(n))).toEqual([]);
  });

  it('maps every token except the derived onDanger', () => {
    const unmapped = (Object.keys(lightColors) as (keyof ThemeColors)[]).filter((k) => !(k in TOKEN_SOURCE));
    expect(unmapped).toEqual(['onDanger']);
  });

  it('light and dark have the same tokens', () => {
    expect(Object.keys(lightColors).sort()).toEqual(Object.keys(darkColors).sort());
  });
});

describe('palette contrast (WCAG)', () => {
  for (const [theme, c] of themes) {
    it(`meets 4.5:1 for text and on-colour pairs (${theme})`, () => {
      const pairs: [string, string, string][] = [
        ['text/background', c.text, c.background],
        ['text/surface', c.text, c.surface],
        ['text/field', c.text, c.field],
        ['textSecondary/background', c.textSecondary, c.background],
        ['textSecondary/surface', c.textSecondary, c.surface],
        ['textSecondary/field', c.textSecondary, c.field],
        ['onPrimary/primary', c.onPrimary, c.primary],
        ['onSun/sun', c.onSun, c.sun],
        ['onDanger/danger', c.onDanger, c.danger],
        ['primaryInk/primaryWash', c.primaryInk, c.primaryWash],
        ['primaryInk/primarySoft', c.primaryInk, c.primarySoft],
      ];
      for (const [name, fg, bg] of pairs) expect(contrast(fg, bg), name).toBeGreaterThanOrEqual(4.5);
    });

    // Ruling R15 (spec §11.1): the approved palette keeps textMuted and the light status pairs under AA's 4.5:1;
    // they're held to 3:1 here. The darker AA values are listed in the spec if the owner asks for them.
    it(`meets 3:1 for muted text and status pairs (${theme})`, () => {
      const pairs: [string, string, string][] = [
        ['textMuted/surface', c.textMuted, c.surface],
        ['textMuted/background', c.textMuted, c.background],
        ['ok/okSoft', c.ok, c.okSoft],
        ['warn/warnSoft', c.warn, c.warnSoft],
        ['danger/dangerSoft', c.danger, c.dangerSoft],
      ];
      for (const [name, fg, bg] of pairs) expect(contrast(fg, bg), name).toBeGreaterThanOrEqual(3);
    });
  }
});

describe('shadowValues', () => {
  for (const [theme, isDark, vars] of [['light', false, mockup.light], ['dark', true, mockup.dark]] as const) {
    it(`raised and float use the mockup's --shadow (${theme})`, () => {
      expect(vars.shadow, `--shadow missing in the ${theme} mockup`).toBeDefined();
      // Offsets and blur from the mockup's `.iconbtn` (raised) and `.footbar` / `.buybar` (float).
      expect(norm(shadowValues(isDark).raised)).toBe(norm(`0 2px 8px ${vars.shadow}`));
      expect(norm(shadowValues(isDark).float)).toBe(norm(`0 8px 22px ${vars.shadow}`));
    });
  }

  it("segment matches the mockup's selected segment (light); dark is derived (spec §4.3)", () => {
    const source = readFileSync(MOCKUP, 'utf8');
    const rules = [...source.matchAll(/\.segmented span\.on\{[^}]*box-shadow:([^;}]+)/g)];
    expect(rules.length).toBeGreaterThan(0);
    expect(norm(shadowValues(false).segment)).toBe(norm(rules[rules.length - 1][1]));
    expect(shadowValues(true).segment).toBe('0 1px 3px rgba(0,0,0,0.5)');
  });
});
