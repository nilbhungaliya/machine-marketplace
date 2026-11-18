import ts from 'typescript';

export type Finding = { file: string; line: number; text: string };

// Only calls whose string arguments are verified never to reach the screen.
// Deliberately absent: generic names like error/info (toast.error IS shown),
// HTTP verbs (URLs never look like prose anyway), and `new Error` (its
// .message is often toasted). Those strings must be translated or allowlisted.
// Only a DIRECT argument is excused, so a params object is still audited.
const IGNORED_CALLS = new Set([
  'track', 'screen', 'require', 't',
  'captureException', 'captureMessage', 'addBreadcrumb',
  'getItem', 'setItem', 'removeItem',
]);
// Route-name methods, ignored only on a navigation object: a bare `push` or
// `replace` is usually Array.push / String.replace carrying real copy.
const NAV_METHODS = new Set(['navigate', 'push', 'replace', 'reset', 'popTo']);
const NAV_OWNERS = new Set(['navigation', 'nav', 'router', 'navigationRef', 'navigationRef.current', 'StackActions', 'CommonActions']);
const isNavOwner = (text: string) => {
  const t = text.replace(/\?/g, '');
  return NAV_OWNERS.has(t) || t.endsWith('.navigation');
};
const IGNORED_ATTRS = new Set(['ph-label', 'phLabel', 'ctaPhLabel', 'testID', 'key', 'nativeID', 'name', 'style', 'source', 'href']);

// Object keys whose values are code: navigation targets, PostHog's list of
// component names to skip, and a tab's testID (React Navigation option).
const IGNORED_KEYS = new Set(['screen', 'ignoreLabels', 'tabBarButtonTestID']);

// Prose: contains a space between letters, or starts Capital+lowercase. Keys,
// enum values, route names and colours never match.
const looksLikeProse = (s: string) => /[A-Za-z]/.test(s) && (/[A-Za-z][^\S\n]+[A-Za-z]/.test(s.trim()) || /^[A-Z][a-z]/.test(s.trim()));
// One token with an underscore or an inner camel hump: a route or font id.
const looksLikeIdentifier = (s: string) => !/\s/.test(s) && (/_/.test(s) || /[a-z][A-Z]/.test(s));

const keyName = (p: ts.PropertyAssignment) => (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : '');

// The `en` half of a locale table that also carries `gu` is the translation itself.
// Limited to lib/format-date.ts: inline tables elsewhere bypass the locale files.
const isEnglishLocaleTable = (file: string, p: ts.PropertyAssignment) =>
  /(^|\/)lib\/format-date\.ts$/.test(file) && keyName(p) === 'en' && ts.isObjectLiteralExpression(p.parent)
  && p.parent.properties.some((q) => ts.isPropertyAssignment(q) && keyName(q) === 'gu');

function calleeName(call: ts.CallExpression | ts.NewExpression): string | undefined {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return undefined;
}

const EQUALITY = [
  ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken,
];

const isDirectValue = (p: ts.PropertyAssignment, node: ts.Node) =>
  p.initializer === node
  || (ts.isArrayLiteralExpression(p.initializer) && p.initializer.elements.some((e) => e === node));

function isExcluded(file: string, node: ts.Node): boolean {
  for (let cur: ts.Node = node, p = node.parent; p; cur = p, p = p.parent) {
    // A callback's body is not owned by the call or object around it.
    if (ts.isFunctionLike(p) && !ts.isTypeNode(p)) return false;
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return true;
    if (ts.isLiteralTypeNode(p) || ts.isTypeNode(p)) return true;
    if (ts.isPropertyAssignment(p) && p.name === cur) return true;
    if (ts.isPropertyAssignment(p) && IGNORED_KEYS.has(keyName(p)) && isDirectValue(p, node)) return true;
    if (ts.isPropertyAssignment(p) && isEnglishLocaleTable(file, p)) return true;
    if (ts.isCaseClause(p) && p.expression === cur) return true;
    if (ts.isBinaryExpression(p) && EQUALITY.includes(p.operatorToken.kind)) return true;
    if (ts.isElementAccessExpression(p) && p.argumentExpression === cur) return true;
    if (ts.isJsxAttribute(p) && IGNORED_ATTRS.has(p.name.getText())) return true;
    if (ts.isCallExpression(p) || ts.isNewExpression(p)) {
      const name = calleeName(p);
      const owner = ts.isPropertyAccessExpression(p.expression) ? p.expression.expression.getText() : '';
      const direct = !!p.arguments?.some((a) => a === node);
      if (direct && name && IGNORED_CALLS.has(name)) return true;
      if (direct && name && NAV_METHODS.has(name) && isNavOwner(owner)) return true;
      if (direct && owner === 'console') return true;
      if (name === 'create' && owner === 'StyleSheet') return true;
    }
    // Stop at the statement: an ancestor call further up does not own this literal.
    if (ts.isStatement(p) || ts.isJsxElement(p) || ts.isJsxSelfClosingElement(p)) return false;
  }
  return false;
}

export function auditSource(file: string, text: string): Finding[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Finding[] = [];
  const add = (node: ts.Node, value: string) => {
    out.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, text: value });
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      const v = node.text.replace(/\s+/g, ' ').trim();
      if (/[A-Za-z]{2,}/.test(v)) add(node, v);
    } else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && looksLikeProse(node.text) && !looksLikeIdentifier(node.text) && !isExcluded(file, node)) {
      add(node, node.text);
    } else if (ts.isTemplateExpression(node) && !isExcluded(file, node)) {
      for (const part of [node.head, ...node.templateSpans.map((s) => s.literal)]) {
        if (looksLikeProse(part.text)) add(part, part.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}
