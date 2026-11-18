import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { auditSource } from './audit';

const texts = (src: string) => auditSource('x.tsx', src).map((f) => f.text);

describe('auditSource', () => {
  it('flags JSX text', () => {
    expect(texts('const A = () => <Text>Book your wash</Text>;')).toEqual(['Book your wash']);
  });
  it('flags prose in ternaries and lookup objects', () => {
    expect(texts("const s = done ? 'Completed' : 'Pending';")).toEqual(['Completed', 'Pending']);
    expect(texts("const L = { completed: 'Completed', pending: 'Waiting for washer' };")).toEqual(['Completed', 'Waiting for washer']);
  });
  it('flags display props and template literals', () => {
    expect(texts('<Button title="Save as default" />')).toEqual(['Save as default']);
    expect(texts('const m = `Expires ${d}`;')).toEqual(['Expires ']);
  });
  it('ignores code-only strings', () => {
    expect(texts("import x from 'react-native';")).toEqual([]);
    expect(texts("if (status === 'Completed') {}")).toEqual([]);
    expect(texts("switch (s) { case 'Completed': break; }")).toEqual([]);
    expect(texts("navigation.navigate('WashTracking');")).toEqual([]);
    expect(texts("track('Wash Booked');")).toEqual([]);
    expect(texts('<View ph-label="Profile-menu-row" testID="Some Id" />')).toEqual([]);
    expect(texts("const s = StyleSheet.create({ a: { fontFamily: 'Inter Bold' } });")).toEqual([]);
    expect(texts("type T = 'Completed' | 'Pending';")).toEqual([]);
    expect(texts("t('wash.book.title');")).toEqual([]);
    expect(texts("const k = 'wash_plans';")).toEqual([]);
    expect(texts("console.warn('Socket reconnect failed');")).toEqual([]);
    expect(texts("api.get('/users/me');")).toEqual([]);
  });
  it('ignores identifier-shaped tokens (route names, font ids)', () => {
    expect(texts("const r = flag ? 'WashTracking' : 'PaymentHistory';")).toEqual([]);
    expect(texts("const f = { regular: 'Inter_400Regular' };")).toEqual([]);
    // Single capitalised words and spaced prose are still flagged.
    expect(texts("const r = flag ? 'Main' : 'Wash plan';")).toEqual(['Main', 'Wash plan']);
  });
  it('ignores navigation targets and analytics labels', () => {
    expect(texts("navigation.popTo('Main', {});")).toEqual([]);
    expect(texts("const x = { screen: 'Main', params: { screen: 'Home' } };")).toEqual([]);
    expect(texts('<Button phLabel="Withdraw-commission" title="Withdraw" />')).toEqual(['Withdraw']);
    expect(texts("const o = { ignoreLabels: ['View', 'Animated(View)'] };")).toEqual([]);
    expect(texts("const o = { tabBarButtonTestID: 'Tab-home', tabBarLabel: 'Home' };")).toEqual(['Home']);
    expect(texts("const o = modes.map((m) => ({ value: m, testID: `Theme-${m}`, label: 'Light' }));")).toEqual(['Light']);
    expect(texts('<EmptyState ctaPhLabel="Add-Vehicle-button" ctaLabel="Add vehicle" />')).toEqual(['Add vehicle']);
  });
  it('ignores the English half of the en/gu table in lib/format-date.ts only', () => {
    const table = "const N = { en: { days: ['Sun', 'Mon'] }, gu: { days: ['રવિ', 'સોમ'] } };";
    expect(auditSource('lib/format-date.ts', table).map((f) => f.text)).toEqual([]);
    expect(auditSource('lib/format-date.ts', "const N = { en: { days: ['Sun', 'Mon'] } };").map((f) => f.text)).toEqual(['Sun', 'Mon']);
    // Inline tables elsewhere bypass the locale files and their parity test.
    expect(texts(table)).toEqual(['Sun', 'Mon']);
  });
  it('does not treat array push or string replace as navigation', () => {
    expect(texts("parts.push('Free to cancel');")).toEqual(['Free to cancel']);
    expect(texts("const s = raw.replace('x', 'Visiting charge');")).toEqual(['Visiting charge']);
    expect(texts("navigation.push('Main');")).toEqual([]);
    expect(texts("navigation.navigate('WashTracking');")).toEqual([]);
    expect(texts("navigationRef.current?.navigate('Main');")).toEqual([]);
    expect(texts("props.navigation.replace('Main');")).toEqual([]);
    expect(texts("navigate('Main');")).toEqual(['Main']);
  });
  it('excuses only direct arguments of ignored calls', () => {
    expect(texts("track('Wash Booked', { onPress: () => toast.error('Payment failed') });")).toEqual(['Payment failed']);
    expect(texts("navigation.navigate('WebView', { title: 'Terms and conditions' });")).toEqual(['Terms and conditions']);
    expect(texts("track('Wash Booked', { label: 'Book now' });")).toEqual(['Book now']);
  });
  it('stops at function boundaries', () => {
    expect(texts("const s = StyleSheet.create({ a: { onPress: () => toast.error('Payment failed') } });")).toEqual(['Payment failed']);
  });
  it('excuses only direct values of ignored keys', () => {
    expect(texts("const x = { screen: { title: 'Book now' } };")).toEqual(['Book now']);
    expect(texts("const x = { ignoreLabels: [{ title: 'Book now' }] };")).toEqual(['Book now']);
  });
  it('flags app-owned messages that can reach the UI', () => {
    expect(texts("throw new Error('Slot no longer available');")).toEqual(['Slot no longer available']);
    expect(texts("toast.error('Payment failed');")).toEqual(['Payment failed']);
    expect(texts("Toast.show({ type: 'error', text1: 'Could not update' });")).toEqual(['Could not update']);
  });
});

const ROOT = path.resolve(__dirname, '../..');
const SCAN_DIRS = ['screens', 'components', 'navigation', 'hooks', 'lib', 'App.tsx'];
const SKIP = [/\.test\.ts$/, /^lib\/i18n\//, /\.d\.ts$/];

type Allow = { file: string; text: string; reason: string };
const allowlist: Allow[] = JSON.parse(fs.readFileSync(path.join(__dirname, 'audit-allowlist.json'), 'utf8'));
const pending: string[] = JSON.parse(fs.readFileSync(path.join(__dirname, 'audit-pending.json'), 'utf8'));

function walk(rel: string): string[] {
  const abs = path.join(ROOT, rel);
  if (fs.statSync(abs).isFile()) return [rel];
  return fs.readdirSync(abs).flatMap((n) => walk(path.join(rel, n)));
}

function scan(files: string[]) {
  return files.flatMap((f) => auditSource(f, fs.readFileSync(path.join(ROOT, f), 'utf8')))
    .filter((x) => !allowlist.some((a) => a.file === x.file && a.text === x.text));
}

const allFiles = SCAN_DIRS.flatMap(walk)
  .map((f) => f.split(path.sep).join('/'))
  .filter((f) => /\.(ts|tsx)$/.test(f) && !SKIP.some((r) => r.test(f)));

describe('translation coverage', () => {
  it('report', () => {
    const only = process.env.AUDIT_FILES?.split(',').map((s: string) => s.trim()).filter(Boolean);
    const findings = scan(only ?? allFiles);
    // Quiet on normal runs; set AUDIT_REPORT=1 (or AUDIT_FILES) to print.
    if (!only && !process.env.AUDIT_REPORT) return;
    for (const f of findings) console.log(`${f.file}:${f.line}  ${JSON.stringify(f.text)}`);
  });

  it('every file outside the pending list has no hard-coded English', () => {
    const findings = scan(allFiles.filter((f) => !pending.includes(f)));
    expect(findings.map((f) => `${f.file}:${f.line} ${f.text}`)).toEqual([]);
  });

  it('nothing is pending any more', () => {
    expect(pending).toEqual([]);
  });

  it('pending lists only files that still need work', () => {
    const clean = pending.filter((f) => !allFiles.includes(f) || scan([f]).length === 0);
    expect(clean, 'remove these from audit-pending.json').toEqual([]);
  });

  it('every allowlist entry has a reason', () => {
    expect(allowlist.filter((a) => !a.reason?.trim())).toEqual([]);
  });

  it('no allowlist entry is obsolete', () => {
    // An entry whose string no longer appears in its file is dead weight that
    // would silently excuse a future string with the same text.
    const raw = (f: string) => (fs.existsSync(path.join(ROOT, f)) ? auditSource(f, fs.readFileSync(path.join(ROOT, f), 'utf8')) : []);
    const stale = allowlist.filter((a) => !raw(a.file).some((x) => x.text === a.text));
    expect(stale.map((a) => `${a.file}: ${a.text}`)).toEqual([]);
  });
});
