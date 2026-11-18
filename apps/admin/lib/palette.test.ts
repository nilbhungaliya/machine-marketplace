import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { ANCHORS, colors } from './palette';

// Palette parity (spec §4.4, §11.1): the admin's remapped Tailwind colours equal the approved mockup's light tokens.

const MOCKUP = path.resolve(__dirname, '../../../docs/mockups/src/build-periwinkle-v2.mjs');

/** Every `:root{…}` block in file order; later blocks win, as in CSS. Light only (R4: the admin is light-only). */
function readMockupLight(): Record<string, string> {
  const source = readFileSync(MOCKUP, 'utf8');
  const light: Record<string, string> = {};
  for (const m of Array.from(source.matchAll(/:root\{([^}]*)\}/g))) {
    for (const decl of m[1].split(';')) {
      const colon = decl.indexOf(':');
      if (colon < 0) continue;
      const name = decl.slice(0, colon).trim();
      if (name.startsWith('--')) light[name.slice(2)] = decl.slice(colon + 1).trim();
    }
  }
  return light;
}

/** `#abc`, `#AABBCC`, `rgba(1,2,3,.5)` and `rgb(1 2 3 / 0.5)` all become `r,g,b,a`. */
function norm(value: string): string {
  const v = value.trim().toLowerCase();
  if (v.startsWith('#')) {
    const h = v.slice(1);
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)).concat(1).join(',');
  }
  const fn = /^rgba?\(([^)]*)\)$/.exec(v);
  if (!fn) return v;
  const parts = fn[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return [...parts.slice(0, 3), parts[3] ?? 1].join(',');
}

function lookup(dotPath: string): string | undefined {
  let node: unknown = colors;
  for (const key of dotPath.split('.')) node = (node as Record<string, unknown> | undefined)?.[key];
  return typeof node === 'string' ? node : undefined;
}

function luminance(hex: string): number {
  const [r, g, b] = norm(hex).split(',').slice(0, 3).map((n) => Number(n) / 255).map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const mockup = readMockupLight();

describe('admin palette parity with the Periwinkle v2 mockup', () => {
  it('reads the mockup tokens', () => {
    expect(mockup.canvas).toBe('#F5F4FA');
    expect(mockup.hair).toBe('#E6E4EE');
  });

  it('anchors every mockup variable of spec §4.4', () => {
    expect(new Set(ANCHORS.map(([, v]) => v))).toEqual(
      new Set([
        'canvas', 'field', 'hair', 'ink-3', 'ink-2', 'ink', 'surface', 'photo', 'primary', 'primary-ink', 'soft',
        'soft2', 'sun', 'on-sun', 'ok', 'ok-soft', 'warn', 'warn-soft', 'danger', 'danger-soft', 'scrim',
      ]),
    );
  });

  for (const [dotPath, varName] of ANCHORS) {
    it(`${dotPath} equals --${varName}`, () => {
      expect(mockup[varName], `--${varName} missing in the mockup`).toBeDefined();
      const value = lookup(dotPath);
      expect(value, `colors.${dotPath} missing`).toBeDefined();
      expect(norm(value!)).toBe(norm(mockup[varName]));
    });
  }

  it('has full 50–950 ramps for the remapped families', () => {
    const steps = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];
    for (const family of ['gray', 'brand', 'red', 'amber', 'green'] as const) {
      expect(Object.keys(colors[family]), family).toEqual(steps);
    }
  });

  it('keeps description text (gray-500) at 4.5:1 on white', () => {
    expect(contrast(colors.gray[500], colors.white)).toBeGreaterThanOrEqual(4.5);
  });
});
