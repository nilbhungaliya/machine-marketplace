import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { AUDIT_EXEMPT, auditClasses } from './style-audit';

// Colours come from the palette (spec §11.2, R16): this audit fails on a hex or rgb colour, an arbitrary Tailwind
// colour value, or a Tailwind colour family the palette doesn't define, anywhere in the admin's source.

const rules = (src: string) => auditClasses('x.tsx', src).map((f) => f.rule);

describe('auditClasses', () => {
  it('flags Tailwind colour families outside the palette', () => {
    expect(rules("const c = 'bg-blue-50';")).toEqual(['off-palette']);
    expect(rules('<p className="text-indigo-600 hover:bg-slate-100" />')).toEqual(['off-palette', 'off-palette']);
    expect(rules("const c = 'ring-sky-500/40 border-rose-200';")).toEqual(['off-palette', 'off-palette']);
    expect(rules("const c = 'focus:outline-violet-600 divide-zinc-100 from-emerald-400';")).toEqual([
      'off-palette', 'off-palette', 'off-palette',
    ]);
    expect(rules("const c = 'bg-side text-side-dim';")).toEqual(['off-palette', 'off-palette']);
  });

  it('flags theme(colors.…) lookups outside the palette', () => {
    expect(rules("const c = 'shadow-[inset_3px_0_0_theme(colors.blue.600)]';")).toEqual(['off-palette']);
    expect(rules("const c = 'ring-[theme(colors.side.DEFAULT)]';")).toEqual(['off-palette']);
    expect(rules("const c = \"theme('colors.indigo.500')\";")).toEqual(['off-palette']);
    expect(rules("const c = 'shadow-[inset_3px_0_0_theme(colors.brand.600)] border-[theme(colors.sun.DEFAULT)]';")).toEqual([]);
    expect(rules("const c = 'bg-[theme(colors.gray.50)] ring-[theme(colors.black)]';")).toEqual([]);
  });

  it('flags arbitrary colour values', () => {
    expect(rules("const c = 'text-[#123456]';")).toEqual(['arbitrary-colour']);
    expect(rules("const c = 'bg-[rgb(1_2_3)]';")).toEqual(['arbitrary-colour']);
    expect(rules("const c = 'border-[hsl(250,80%,60%)]';")).toEqual(['arbitrary-colour']);
    expect(rules("const c = 'shadow-[0_1px_3px_rgb(28_20_70/0.14)]';")).toEqual(['arbitrary-colour']);
  });

  it('flags hex and rgb/hsl colours in code', () => {
    expect(rules("<div style={{ color: '#fff' }} />")).toEqual(['hex']);
    expect(rules("const s = { backgroundColor: 'rgba(0,0,0,0.9)' };")).toEqual(['rgb']);
    expect(rules("const s = 'hsl(250 80% 60%)';")).toEqual(['rgb']);
    expect(rules("const fill = '#5B41E6CC';")).toEqual(['hex']);
    expect(rules("const s = { color: '#000' };")).toEqual(['hex']);
    expect(rules("const s = 'color:#000000';")).toEqual(['hex']);
    expect(rules("const s = '1px solid #abc';")).toEqual(['hex']);
  });

  it('does not flag numbers after a # in copy', () => {
    expect(rules("const t = 'Order #123'; const u = `Ticket #2024 of ${n}`; const v = 'Row #123456';")).toEqual([]);
  });

  it('allows palette classes, black/white and non-colour lookalikes', () => {
    expect(rules("const c = 'bg-brand-600 text-white';")).toEqual([]);
    expect(rules("const c = 'bg-black/80';")).toEqual([]);
    expect(rules("const c = 'bg-sun text-sun-ink bg-photo bg-scrim';")).toEqual([]);
    expect(rules("const c = 'text-gray-500 ring-red-600 border-amber-200 bg-green-50';")).toEqual([]);
    expect(rules("const c = 'shadow-[inset_3px_0_0_theme(colors.brand.600)] h-[18px] text-[13.5px]';")).toEqual([]);
    expect(rules("const c = 'border-side-l';")).toEqual(['off-palette']);
    expect(rules("const href = '/x#section'; const r = 'Order #12'; const s = 'side-panel';")).toEqual([]);
    expect(rules("const t = 'Dark blue and rose'; const k = 'blue';")).toEqual([]);
  });

  it('ignores comments', () => {
    expect(rules('// was bg-blue-50 and #fff\nconst c = 1;')).toEqual([]);
    expect(rules('/* text-indigo-600 rgb(1,2,3) */ const c = 1;')).toEqual([]);
    expect(rules('{/* bg-blue-50 */}')).toEqual([]);
  });

  it('reports the line number and text', () => {
    const [f] = auditClasses('a.tsx', "const a = 1;\nconst c = 'bg-blue-50';");
    expect(f).toMatchObject({ file: 'a.tsx', line: 2, rule: 'off-palette', text: 'bg-blue-50' });
  });
});

describe('the admin source', () => {
  const root = path.resolve(__dirname, '..');

  function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
    });
  }

  it('has no hard-coded or off-palette colours', () => {
    const files = ['app', 'components', 'lib'].flatMap((d) => walk(path.join(root, d)));
    expect(files.length).toBeGreaterThan(50);
    const findings = files.flatMap((full) => {
      const rel = path.relative(root, full).split(path.sep).join('/');
      return auditClasses(rel, fs.readFileSync(full, 'utf8')).filter(
        (f) => !AUDIT_EXEMPT.some((x) => x.file === rel && (x.text === undefined || x.text === f.text)),
      );
    });
    expect(findings).toEqual([]);
  });

  it('every exemption is still needed', () => {
    for (const x of AUDIT_EXEMPT) {
      const source = fs.readFileSync(path.join(root, x.file), 'utf8');
      const hits = auditClasses(x.file, source).filter((f) => x.text === undefined || f.text === x.text);
      expect(hits.length, `${x.file}: ${x.reason}`).toBeGreaterThan(0);
    }
  });
});
