import ts from 'typescript';

// Style audit (spec §11.2, R16): colours live in `lib/palette.ts` and reach components through `useTheme()`; type
// comes from `fonts.*` / `useType()`. Scans the TypeScript AST (as `lib/i18n/audit.ts` does), so comments never count.
// `style-audit.test.ts` runs it over the whole app; `style-audit-allowlist.json` lists the files that may hold colours.

export type StyleRule = 'hex' | 'rgb' | 'named-colour' | 'font-weight' | 'font-family-literal';
export type StyleFinding = { file: string; line: number; rule: StyleRule; text: string };
export type StyleAllow = { path: string; reason: string };

/** A `path` ending in `/` covers the folder; otherwise the file must match exactly. */
export const isAllowlisted = (file: string, allowlist: StyleAllow[]) =>
  allowlist.some((a) => (a.path.endsWith('/') ? file.startsWith(a.path) : file === a.path));

// A hex colour starts the string or follows a space, `(`, `,` or `:`, and is 3, 4, 6 or 8 hex digits long.
const HEX = /(?:^|[\s(,:])(#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4}))(?![0-9a-z_-])/gi;
const RGB = /\b(?:rgba?|hsla?)\(/i;

// CSS named colours (`transparent` and `currentColor` are allowed).
const NAMED_COLOURS = new Set([
  'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque', 'black', 'blanchedalmond', 'blue',
  'blueviolet', 'brown', 'burlywood', 'cadetblue', 'chartreuse', 'chocolate', 'coral', 'cornflowerblue', 'cornsilk',
  'crimson', 'cyan', 'darkblue', 'darkcyan', 'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey', 'darkkhaki',
  'darkmagenta', 'darkolivegreen', 'darkorange', 'darkorchid', 'darkred', 'darksalmon', 'darkseagreen',
  'darkslateblue', 'darkslategray', 'darkslategrey', 'darkturquoise', 'darkviolet', 'deeppink', 'deepskyblue',
  'dimgray', 'dimgrey', 'dodgerblue', 'firebrick', 'floralwhite', 'forestgreen', 'fuchsia', 'gainsboro',
  'ghostwhite', 'gold', 'goldenrod', 'gray', 'green', 'greenyellow', 'grey', 'honeydew', 'hotpink', 'indianred',
  'indigo', 'ivory', 'khaki', 'lavender', 'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral',
  'lightcyan', 'lightgoldenrodyellow', 'lightgray', 'lightgreen', 'lightgrey', 'lightpink', 'lightsalmon',
  'lightseagreen', 'lightskyblue', 'lightslategray', 'lightslategrey', 'lightsteelblue', 'lightyellow', 'lime',
  'limegreen', 'linen', 'magenta', 'maroon', 'mediumaquamarine', 'mediumblue', 'mediumorchid', 'mediumpurple',
  'mediumseagreen', 'mediumslateblue', 'mediumspringgreen', 'mediumturquoise', 'mediumvioletred', 'midnightblue',
  'mintcream', 'mistyrose', 'moccasin', 'navajowhite', 'navy', 'oldlace', 'olive', 'olivedrab', 'orange',
  'orangered', 'orchid', 'palegoldenrod', 'palegreen', 'paleturquoise', 'palevioletred', 'papayawhip', 'peachpuff',
  'peru', 'pink', 'plum', 'powderblue', 'purple', 'rebeccapurple', 'red', 'rosybrown', 'royalblue', 'saddlebrown',
  'salmon', 'sandybrown', 'seagreen', 'seashell', 'sienna', 'silver', 'skyblue', 'slateblue', 'slategray',
  'slategrey', 'snow', 'springgreen', 'steelblue', 'tan', 'teal', 'thistle', 'tomato', 'turquoise', 'violet',
  'wheat', 'white', 'whitesmoke', 'yellow', 'yellowgreen',
]);

// Props and JSX attributes that take a colour: `color`, `colors` (gradients), SVG `fill` / `stroke`, and any `*Color`
// / `*Colors` (`backgroundColor`, `stopColor`, `tintColor`).
const COLOUR_PROP = /^(color|colors|fill|stroke)$|Colou?rs?$/;
// Variables that hold colours: `ACCENT`, `BRAND_COLOR`, `colors`, `TONE` / `TONES`, `palette`, `tint`, `fg` / `bg`. A
// string in such a variable, or anywhere in the object or array literal assigned to it, is a colour.
const COLOUR_VAR = /(colou?rs?|tones?|palette|accent|tint|fill|stroke|bg|fg)$/i;

function propName(name: ts.PropertyName | ts.JsxAttributeName | ts.BindingName): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  return '';
}

const isLogical = (p: ts.BinaryExpression) =>
  p.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || p.operatorToken.kind === ts.SyntaxKind.BarBarToken;

/**
 * Whether a string sits in a colour slot: the value of a colour prop or attribute, or inside a colour-named variable's
 * initialiser. Looks through `a ? b : c`, `a ?? b`, `a || b`, `( )`, `{ }`, `as`, `satisfies`, `<T>`, `!` and array
 * literals; inside an object literal it keeps walking up, so `const TONE = { ok: { fg: 'green' } }` counts. A call
 * stops the walk (its arguments aren't the colour itself).
 */
function inColourSlot(node: ts.Node): boolean {
  let cur: ts.Node = node;
  for (let p = node.parent; p; cur = p, p = p.parent) {
    if (ts.isPropertyAssignment(p)) {
      if (p.initializer !== cur) return false;
      if (COLOUR_PROP.test(propName(p.name))) return true;
      continue; // into the enclosing object literal
    }
    if (ts.isJsxAttribute(p)) return COLOUR_PROP.test(propName(p.name));
    if (ts.isVariableDeclaration(p)) return p.initializer === cur && COLOUR_VAR.test(propName(p.name));
    if (ts.isConditionalExpression(p) && p.condition !== cur) continue;
    if (ts.isBinaryExpression(p) && isLogical(p)) continue;
    if (ts.isParenthesizedExpression(p) || ts.isJsxExpression(p) || ts.isAsExpression(p) || ts.isSatisfiesExpression(p)
      || ts.isTypeAssertionExpression(p) || ts.isNonNullExpression(p) || ts.isArrayLiteralExpression(p)
      || ts.isObjectLiteralExpression(p)) continue;
    return false;
  }
  return false;
}

const isStringNode = (n: ts.Node): n is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral =>
  ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n);

export function auditStyles(file: string, source: string): StyleFinding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const findings: StyleFinding[] = [];
  const add = (node: ts.Node, rule: StyleRule, text: string) =>
    findings.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, rule, text });

  const checkText = (node: ts.Node, text: string) => {
    for (const m of text.matchAll(HEX)) add(node, 'hex', m[1]);
    if (RGB.test(text)) add(node, 'rgb', text);
  };

  const visit = (node: ts.Node) => {
    // Module paths are code, not colours.
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;

    if (isStringNode(node)) {
      checkText(node, node.text);
      if (NAMED_COLOURS.has(node.text.trim().toLowerCase()) && inColourSlot(node)) add(node, 'named-colour', node.text);
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      checkText(node, node.text);
    }

    if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node) || ts.isJsxAttribute(node)) {
      const name = propName(node.name);
      if (name === 'fontWeight') add(node, 'font-weight', node.getText(sf));
      if (name === 'fontFamily') {
        const value = ts.isPropertyAssignment(node) ? node.initializer
          : ts.isJsxAttribute(node) ? node.initializer : undefined;
        const literal = value && (isStringNode(value)
          || (ts.isJsxExpression(value) && value.expression && isStringNode(value.expression)));
        if (literal) add(node, 'font-family-literal', node.getText(sf));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}
