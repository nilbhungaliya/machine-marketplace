import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { auditStyles, isAllowlisted, type StyleAllow } from './style-audit';

// Colours come from the palette and type from the scale (spec §11.2, R16): this audit fails on a hard-coded colour,
// a `fontWeight` or a literal `fontFamily` anywhere in the app's source.

const rules = (src: string) => auditStyles('x.tsx', src).map((f) => f.rule);

describe('auditStyles', () => {
  it('flags hex colours', () => {
    expect(rules("const s = { color: '#fff' };")).toEqual(['hex']);
    expect(rules("const s = { borderColor: '#5B41E6CC' };")).toEqual(['hex']);
    expect(rules("const b = '1px solid #e6e4ee';")).toEqual(['hex']);
    expect(rules('const t = `0 2px 8px #000`;')).toEqual(['hex']);
    expect(rules('const t = `${a} #abcd`;')).toEqual(['hex']);
    expect(rules("const css = 'color:#fff';")).toEqual(['hex']);
  });

  it('flags rgb and hsl functions', () => {
    expect(rules("const s = { backgroundColor: 'rgba(0,0,0,.5)' };")).toEqual(['rgb']);
    expect(rules("const s = 'rgb(1, 2, 3)';")).toEqual(['rgb']);
    expect(rules("const s = 'hsl(250, 80%, 60%)';")).toEqual(['rgb']);
  });

  it('flags named colours on colour props', () => {
    expect(rules('const a = <Icon color="white" />;')).toEqual(['named-colour']);
    expect(rules("const s = { shadowColor: 'black' };")).toEqual(['named-colour']);
    expect(rules("const s = { color: dark ? 'white' : colors.text };")).toEqual(['named-colour']);
    expect(rules('const a = <View backgroundColor={"red"} />;')).toEqual(['named-colour']);
  });

  it('flags named colours on SVG paint props and colour arrays', () => {
    expect(rules('const a = <Path fill="white" stroke="black" />;')).toEqual(['named-colour', 'named-colour']);
    expect(rules('const a = <Stop stopColor="white" />;')).toEqual(['named-colour']);
    expect(rules("const a = <LinearGradient colors={['white', 'black']} />;")).toEqual(['named-colour', 'named-colour']);
  });

  it('looks through type assertions and non-null', () => {
    expect(rules("const s = { color: 'white' as const };")).toEqual(['named-colour']);
    expect(rules("const s = { color: 'white' satisfies string };")).toEqual(['named-colour']);
    // `<const>x` is a type assertion only in .ts (in .tsx it's JSX).
    expect(auditStyles('x.ts', "const s = { color: <const>'white' };").map((f) => f.rule)).toEqual(['named-colour']);
    expect(rules("const s = { color: (maybe ?? 'white')! };")).toEqual(['named-colour']);
  });

  it('flags named colours in colour-named variables and the objects assigned to them', () => {
    expect(rules("const ACCENT = 'white';")).toEqual(['named-colour']);
    expect(rules("const BRAND_COLOR = 'purple';")).toEqual(['named-colour']);
    expect(rules("const TONE = { ok: 'green', bad: 'red' };")).toEqual(['named-colour', 'named-colour']);
    expect(rules("const TONES = { ok: { fg: 'green' } } as const;")).toEqual(['named-colour']);
    expect(rules("const colors = ['white', 'black'];")).toEqual(['named-colour', 'named-colour']);
  });

  it('allows transparent, currentColor and non-colour props', () => {
    expect(rules("const s = { borderColor: 'transparent' };")).toEqual([]);
    expect(rules('const a = <Icon color="currentColor" />;')).toEqual([]);
    expect(rules("const s = { tone: 'red' };")).toEqual([]);
    expect(rules("const s = { color: colors.text };")).toEqual([]);
    expect(rules("const side = 'left'; const mode = 'white';")).toEqual([]);
    expect(rules("const STATUS = { ok: 'green' };")).toEqual([]);
    expect(rules("const TONE = { ok: label('green') };")).toEqual([]);
    expect(rules("const a = <Notice tone=\"red\" />;")).toEqual([]);
  });

  it('flags fontWeight', () => {
    expect(rules("const s = { fontWeight: '700' };")).toEqual(['font-weight']);
    expect(rules('const s = { fontWeight: weight };')).toEqual(['font-weight']);
  });

  it('flags a literal fontFamily, not a token', () => {
    expect(rules("const s = { fontFamily: 'Inter_400Regular' };")).toEqual(['font-family-literal']);
    expect(rules('const s = { fontFamily: fonts.bold };')).toEqual([]);
    expect(rules("const s = { ...type('title') };")).toEqual([]);
  });

  it('ignores hashes that are not colours, and comments', () => {
    expect(rules("const id = 'abc#123';")).toEqual([]);
    expect(rules("const r = 'Order #12';")).toEqual([]);
    expect(rules("const h = '#section-2';")).toEqual([]);
    expect(rules('// #fff\nconst a = 1;')).toEqual([]);
    expect(rules('/* rgba(0,0,0,.5) */ const a = 1;')).toEqual([]);
  });

  it('reports the line and text', () => {
    expect(auditStyles('x.tsx', "const a = 1;\nconst s = { color: '#fff' };")).toEqual([
      { file: 'x.tsx', line: 2, rule: 'hex', text: '#fff' },
    ]);
  });
});

describe('isAllowlisted', () => {
  const allow: StyleAllow[] = [{ path: 'lib/palette.ts', reason: 'r' }, { path: 'components/art/', reason: 'r' }];
  it('matches a file exactly or a folder by prefix', () => {
    expect(isAllowlisted('lib/palette.ts', allow)).toBe(true);
    expect(isAllowlisted('lib/palette.test.ts', allow)).toBe(false);
    expect(isAllowlisted('components/art/GearShot.tsx', allow)).toBe(true);
    expect(isAllowlisted('components/Card.tsx', allow)).toBe(false);
  });
});

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '__mocks__', 'android', 'ios', 'dist']);
const allowlist: StyleAllow[] = JSON.parse(fs.readFileSync(path.join(__dirname, 'style-audit-allowlist.json'), 'utf8'));

function walk(rel: string): string[] {
  return fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true }).flatMap((d) => {
    const child = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) return SKIP_DIRS.has(d.name) || d.name.startsWith('.') ? [] : walk(child);
    return /\.tsx?$/.test(d.name) && !/\.test\.ts$/.test(d.name) && !/\.d\.ts$/.test(d.name) ? [child] : [];
  });
}

describe('the app source', () => {
  it('has no hard-coded colours, font weights or font families', () => {
    const files = walk('').filter((f) => !isAllowlisted(f, allowlist));
    expect(files.length).toBeGreaterThan(30);
    const findings = files.flatMap((f) => auditStyles(f, fs.readFileSync(path.join(ROOT, f), 'utf8')));
    expect(findings.map((f) => `${f.file}:${f.line} [${f.rule}] ${f.text}`)).toEqual([]);
  });

  it('every allowlist entry has a reason', () => {
    for (const a of allowlist) expect(a.reason.length, a.path).toBeGreaterThan(10);
  });
});
