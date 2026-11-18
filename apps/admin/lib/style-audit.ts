// Style audit (spec §11.2, ruling R16): colours in the admin come from the palette (`lib/palette.ts` via Tailwind).
// A regex scan of the source text is enough here: Tailwind classes are plain strings. Run by lib/style-audit.test.ts
// over app/, components/ and lib/.

export type AuditRule = 'hex' | 'rgb' | 'arbitrary-colour' | 'off-palette';

export interface AuditFinding {
  file: string;
  line: number;
  rule: AuditRule;
  text: string;
}

/** Files (or one finding in a file, by its text) the audit lets through, each with its reason. */
export const AUDIT_EXEMPT: Array<{ file: string; text?: string; reason: string }> = [
  { file: 'lib/palette.ts', reason: 'the palette itself' },
  { file: 'lib/style-audit.ts', reason: 'names the exemptions below' },
  {
    file: 'components/ui/tabs.tsx',
    text: 'shadow-[0_1px_3px_rgb(28_20_70/0.14)]',
    reason: "the selected segment's shadow, from the mockup's `.segmented span.on` (spec §10.2)",
  },
];

/** Tailwind's colour families that the palette doesn't define, plus the retired dark-sidebar `side` palette. */
const OFF_PALETTE = [
  'slate', 'zinc', 'neutral', 'stone', 'orange', 'yellow', 'lime', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo',
  'violet', 'purple', 'fuchsia', 'pink', 'rose', 'side',
];

/** Utilities that take a colour. */
const COLOUR_UTILITIES =
  'bg|text|border(?:-[xytrblse])?|ring|ring-offset|outline|divide|from|via|to|fill|stroke|placeholder|accent|caret|decoration|shadow';

const ARBITRARY = /(?<![\w-])[a-z][\w-]*-\[[^\]\s'"`]*?(?:#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\()[^\]\s'"`]*\]/g;
const OFF = new RegExp(
  `(?<![\\w-])(?:${COLOUR_UTILITIES})-(?:${OFF_PALETTE.join('|')})(?:-[a-z0-9]+)*(?:\\/\\d+)?(?![\\w-])`,
  'g',
);
const HEX = /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w])/g;
const RGB = /(?<![\w-])(?:rgba?|hsla?)\(/g;

/** Blanks out comments, keeping offsets and newlines, so line numbers stay right. */
function stripComments(source: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, ' ');
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:'"`\\])(\/\/[^\n]*)/g, (_m, pre: string, comment: string) => pre + blank(comment));
}

export function auditClasses(file: string, source: string): AuditFinding[] {
  let code = stripComments(source);
  const found: { index: number; rule: AuditRule; text: string }[] = [];
  const take = (re: RegExp, rule: AuditRule) => {
    for (const m of Array.from(code.matchAll(re))) found.push({ index: m.index ?? 0, rule, text: m[0] });
  };

  take(ARBITRARY, 'arbitrary-colour');
  // An arbitrary value is reported once, not again as a hex or rgb.
  code = code.replace(ARBITRARY, (m) => ' '.repeat(m.length));
  take(OFF, 'off-palette');
  take(HEX, 'hex');
  take(RGB, 'rgb');

  return found
    .sort((a, b) => a.index - b.index)
    .map(({ index, rule, text }) => ({
      file,
      line: source.slice(0, index).split('\n').length,
      rule,
      text: rule === 'rgb' ? lineAt(source, index) : text,
    }));
}

function lineAt(source: string, index: number): string {
  const start = source.lastIndexOf('\n', index - 1) + 1;
  const end = source.indexOf('\n', index);
  return source.slice(start, end < 0 ? undefined : end).trim();
}
