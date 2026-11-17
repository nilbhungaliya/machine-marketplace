'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { openDialogCount, topDialogPanel } from '@/components/ui/dialog';

/**
 * Arrow keys move focus to the nearest control in that direction, like a TV
 * remote; Esc steps out of a text field, then back to the page's back link.
 * No letter shortcuts. Mounted once in the dashboard shell.
 *
 * Markers: [data-nav-main] / [data-nav-sidebar] (where the first press lands),
 * [data-back-link] (where Esc goes), [data-nav-scope] (an open popover: arrows
 * stay inside it while they can, and it hides what it covers), and
 * [data-arrows="native"] (a region that keeps its own arrow keys).
 */

export type Dir = 'up' | 'down' | 'left' | 'right';
export interface Box { top: number; bottom: number; left: number; right: number }

const DIRS: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
export const arrowDir = (key: string): Dir | undefined => DIRS[key];

const AREAS = '[data-nav-main], [data-nav-sidebar], header';
const FOCUSABLE = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex]';

// Widgets that keep every arrow key: lists, menus, sliders, maps, media.
// Radio groups are not here: they move along themselves and let the arrow
// through at their ends (ChoiceGroup, and native radios below).
const OWN_ARROWS = [
  ...['listbox', 'menu', 'menubar', 'grid', 'treegrid', 'tree', 'combobox', 'slider', 'spinbutton', 'scrollbar']
    .map((r) => `[role=${r}]`),
  '[data-arrows="native"]', '.gm-style', 'video', 'audio', 'select[multiple]', 'select[size]:not([size="1"])',
  '[contenteditable]:not([contenteditable="false"])',
].join(', ');

const TEXT_TYPES = new Set(['text', 'search', 'email', 'tel', 'url', 'password']);
const BUTTON_TYPES = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'image', 'file', 'color']);

/**
 * Who gets this arrow key: 'native' leaves it to the control, 'nav' moves focus,
 * 'edge' lets the control have it and moves focus only if it did nothing
 * (a textarea's caret already on its first or last line).
 */
export function arrowMode(el: Element, key: string): 'native' | 'nav' | 'edge' {
  if (el.closest(OWN_ARROWS)) return 'native';
  if (el instanceof HTMLElement && el.isContentEditable) return 'native';
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
  // Tabs rove along their own axis; the other axis leaves the strip.
  const tablist = el.closest('[role=tablist]');
  if (tablist) return (tablist.getAttribute('aria-orientation') === 'vertical') !== horizontal ? 'native' : 'nav';
  if (el instanceof HTMLTextAreaElement) return horizontal ? 'native' : 'edge';
  // ↑ ↓ change the value; ← → leave.
  if (el instanceof HTMLSelectElement) return horizontal ? 'nav' : 'native';
  if (el instanceof HTMLInputElement) {
    if (BUTTON_TYPES.has(el.type)) return 'nav';
    if (el.type === 'range') return 'native';
    // ← → move the caret; ↑ ↓ leave a single-line field unless it has a suggestion list.
    if (TEXT_TYPES.has(el.type)) {
      return horizontal || el.hasAttribute('list') || el.classList.contains('pac-target-input') ? 'native' : 'nav';
    }
    return horizontal ? 'nav' : 'native'; // number, date, time…
  }
  return 'nav';
}

/** What Esc steps out of (blur) rather than going back from: fields, choices, tabs, a map. */
export function isField(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return el.type === 'radio' || !BUTTON_TYPES.has(el.type);
  const role = el.getAttribute('role');
  if (role === 'radio' || role === 'tab') return true;
  return !!el.closest('[contenteditable]:not([contenteditable="false"]), .gm-style');
}

// Esc goes back only from "nowhere in particular": the page itself, plain
// content, or a table row; never from a button or link.
const INTERACTIVE = 'a[href], button, input, select, textarea, summary, [role=button], [role=link], [role=checkbox], '
  + '[role=switch], [role=menuitem], [role=option], [role=combobox]';
function escGoesBack(t: EventTarget | null): boolean {
  if (!(t instanceof Element) || t === document.body || t === document.documentElement) return true;
  if (t.matches('tr[data-row-link]')) return true;
  return !!t.closest('[data-nav-main]') && !t.closest(INTERACTIVE);
}

// Geometry after Android's FocusFinder: a candidate must lie in the direction;
// one overlapping the source across the axis ("in the beam") beats one that
// does not, then the nearest by a distance that weighs the main axis heavier.
const horizontal = (d: Dir) => d === 'left' || d === 'right';

function inDirection(s: Box, d: Box, dir: Dir): boolean {
  switch (dir) {
    case 'right': return (s.left < d.left || s.right <= d.left) && s.right < d.right;
    case 'left': return (s.right > d.right || s.left >= d.right) && s.left > d.left;
    case 'down': return (s.top < d.top || s.bottom <= d.top) && s.bottom < d.bottom;
    case 'up': return (s.bottom > d.bottom || s.top >= d.bottom) && s.top > d.top;
  }
}

function major(s: Box, d: Box, dir: Dir): number {
  const v = { right: d.left - s.right, left: s.left - d.right, down: d.top - s.bottom, up: s.top - d.bottom }[dir];
  return Math.max(0, v);
}

function majorToFarEdge(s: Box, d: Box, dir: Dir): number {
  const v = { right: d.right - s.right, left: s.left - d.left, down: d.bottom - s.bottom, up: s.top - d.top }[dir];
  return Math.max(1, v);
}

function minor(s: Box, d: Box, dir: Dir): number {
  return horizontal(dir)
    ? Math.abs((s.top + s.bottom) / 2 - (d.top + d.bottom) / 2)
    : Math.abs((s.left + s.right) / 2 - (d.left + d.right) / 2);
}

function inBeam(s: Box, d: Box, dir: Dir): boolean {
  return horizontal(dir) ? d.bottom > s.top && d.top < s.bottom : d.right > s.left && d.left < s.right;
}

function beamBeats(s: Box, a: Box, b: Box, dir: Dir): boolean {
  if (inBeam(s, b, dir) || !inBeam(s, a, dir)) return false;
  if (horizontal(dir)) return true;
  // Up/down: an off-beam control wins only if it sits wholly nearer.
  return major(s, a, dir) < majorToFarEdge(s, b, dir);
}

const weighted = (s: Box, d: Box, dir: Dir) => 13 * major(s, d, dir) ** 2 + minor(s, d, dir) ** 2;

/** The best candidate in `dir` from `source`, or null. Ties keep the earlier one (DOM order). */
export function pickInDirection<T>(source: Box, items: Array<{ item: T; box: Box }>, dir: Dir): T | null {
  let best: { item: T; box: Box } | null = null;
  for (const c of items) {
    if (!inDirection(source, c.box, dir)) continue;
    if (!best || beamBeats(source, c.box, best.box, dir)) { best = c; continue; }
    if (beamBeats(source, best.box, c.box, dir)) continue;
    if (weighted(source, c.box, dir) < weighted(source, best.box, dir)) best = c;
  }
  return best?.item ?? null;
}

type Candidate = { item: HTMLElement; box: Box };

const toBox = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
};

function usable(el: HTMLElement, box: Box): boolean {
  if ((el.tabIndex < 0 && !el.hasAttribute('data-row-link')) || el.matches(':disabled') || el.closest('[inert], [aria-hidden="true"]')) return false;
  if (box.right - box.left <= 1 && box.bottom - box.top <= 1) return false; // display:none, sr-only
  const check = (el as { checkVisibility?: (o?: object) => boolean }).checkVisibility;
  return !check || check.call(el, { visibilityProperty: true, checkVisibilityCSS: true });
}

const centreIn = (b: Box, area: Box) => {
  const x = (b.left + b.right) / 2;
  const y = (b.top + b.bottom) / 2;
  return x >= area.left && x <= area.right && y >= area.top && y <= area.bottom;
};

function candidates(container: Element): Candidate[] {
  const all: Candidate[] = [];
  for (const el of Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))) {
    const box = toBox(el);
    if (usable(el, box)) all.push({ item: el, box });
  }
  // An open popover hides the controls under it.
  const scopes = Array.from(container.querySelectorAll('[data-nav-scope]')).map((s) => ({ el: s, box: toBox(s) }));
  return all.filter((c) => !scopes.some((s) => !s.el.contains(c.item) && centreIn(c.box, s.box)));
}

/** Where the first press lands when nothing has focus. */
function firstStop(container: Element, all: Candidate[], dir: Dir): HTMLElement | null {
  if (container !== document.body) {
    return (all.find((c) => !c.item.hasAttribute('data-dialog-close')) ?? all[0])?.item ?? null;
  }
  const within = (sel: string) => all.find((c) => c.item.closest(sel))?.item ?? null;
  if (dir === 'left') {
    const current = all.find((c) => c.item.closest('[data-nav-sidebar]') && c.item.getAttribute('aria-current') === 'page');
    return current?.item ?? within('[data-nav-sidebar]') ?? all[0]?.item ?? null;
  }
  return within('[data-nav-main]') ?? all[0]?.item ?? null;
}

function nextFrom(from: HTMLElement, all: Candidate[], dir: Dir): HTMLElement | null {
  const src = toBox(from);
  const others = all.filter((c) => c.item !== from && !c.item.contains(from));
  // A focused row: ← → walk the controls inside it, from the edge they start at.
  if (horizontal(dir)) {
    const inner = others.filter((c) => from.contains(c.item));
    const edge = dir === 'right' ? { ...src, right: src.left } : { ...src, left: src.right };
    const hit = inner.length ? pickInDirection(edge, inner, dir) : null;
    if (hit) return hit;
  }
  const outside = others.filter((c) => !from.contains(c.item));
  const scope = from.closest('[data-nav-scope]');
  if (scope) {
    const hit = pickInDirection(src, outside.filter((c) => scope.contains(c.item)), dir);
    if (hit) return hit;
  }
  // Stay in the area first (page, sidebar, top bar): a tall table row would
  // otherwise lose to a sidebar link that happens to sit nearer on screen.
  const area = from.closest(AREAS);
  if (area) {
    const hit = pickInDirection(src, outside.filter((c) => area.contains(c.item)), dir);
    if (hit) return hit;
  }
  return pickInDirection(src, outside, dir);
}

/**
 * The next choice along a radio group in `dir`, or null at its end and across
 * it, so the arrow can leave the group. No wrapping.
 */
export function pickInGroup(from: HTMLElement, items: HTMLElement[], dir: Dir): HTMLElement | null {
  const others = items.filter((el) => el !== from && !el.matches(':disabled')).map((item) => ({ item, box: toBox(item) }));
  return pickInDirection(toBox(from), others, dir);
}

/** A native radio's group: same name, same form. */
function radioGroup(r: HTMLInputElement): HTMLInputElement[] {
  if (!r.name) return [r];
  const scope: ParentNode = r.form ?? r.ownerDocument;
  return Array.from(scope.querySelectorAll<HTMLInputElement>('input[type=radio]'))
    .filter((x) => x.name === r.name && x.form === r.form);
}

/** The region arrows may move within: the top dialog, else the whole page. */
function topLayer(): Element | null {
  if (openDialogCount() > 0) return topDialogPanel();
  const modals = document.querySelectorAll('[aria-modal="true"]');
  return modals.length ? modals[modals.length - 1] : document.body;
}

const modified = (e: KeyboardEvent) => e.altKey || e.ctrlKey || e.metaKey || e.shiftKey;

export function useKeyboardNav() {
  useEffect(() => {
    // The field Esc stepped out of: the next arrow starts from it, not from the top.
    let anchor: HTMLElement | null = null;
    const forget = () => { anchor = null; };

    const onEscape = (e: KeyboardEvent) => {
      if (e.repeat || openDialogCount() > 0 || document.querySelector('[aria-modal="true"]')) return;
      const t = e.target;
      if (t instanceof HTMLElement && isField(t)) {
        // The map's focus sits on an inner element; remember the map's own box.
        const field = (t.closest('.gm-style') as HTMLElement | null) ?? t;
        anchor = field;
        // Later, so a field's own Esc (an inline editor reverting) has re-rendered first.
        setTimeout(() => { if (document.activeElement === t) t.blur(); }, 0);
        return;
      }
      if (!escGoesBack(t)) return;
      // Through the link itself, so the unsaved-changes guard sees it like a click.
      const back = document.querySelector<HTMLElement>('[data-back-link]');
      if (back) { e.preventDefault(); back.click(); }
    };

    const go = (from: HTMLElement | null, dir: Dir, container: Element, skip: Element[] = []): boolean => {
      const all = candidates(container).filter((c) => !skip.includes(c.item));
      const next = from ? nextFrom(from, all, dir) : firstStop(container, all, dir);
      if (!next) return false;
      next.focus({ preventScroll: true });
      next.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      return true;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || modified(e) || e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') { onEscape(e); return; }
      const dir = DIRS[e.key];
      if (!dir) return;
      const container = topLayer();
      if (!container || container.closest('[data-arrows="native"]')) return;
      const t = e.target instanceof HTMLElement && e.target !== document.body ? e.target : null;
      const mode = t ? arrowMode(t, e.key) : 'nav';
      if (mode === 'native') return;
      if (t && mode === 'edge') {
        // Let the caret move; if it could not (first or last line), leave the field.
        const ta = t as HTMLTextAreaElement;
        const was = [ta.selectionStart, ta.selectionEnd, ta.value].join('|');
        setTimeout(() => {
          if (document.activeElement === ta && [ta.selectionStart, ta.selectionEnd, ta.value].join('|') === was) go(ta, dir, container);
        }, 0);
        return;
      }

      const active = document.activeElement;
      // The page area itself (focused after a menu click) counts as nothing focused.
      const focused = active instanceof HTMLElement && active !== document.body && active !== container
        && !active.hasAttribute('data-nav-main') && container.contains(active) ? active : null;
      const from = focused ?? (anchor?.isConnected && container.contains(anchor) ? anchor : null);
      // A native radio moves along its group like the browser's own, but stops
      // at the ends (no wrap) so the arrow can leave the group.
      if (from instanceof HTMLInputElement && from.type === 'radio') {
        e.preventDefault(); // always: the browser's own handling wraps round
        const group = radioGroup(from);
        const next = pickInGroup(from, group, dir);
        if (next) { next.focus(); next.click(); } else go(from, dir, container, group);
        return;
      }
      // Nothing that way: the page scrolls as usual.
      if (go(from, dir, container)) e.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', forget);
    document.addEventListener('mousedown', forget);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', forget);
      document.removeEventListener('mousedown', forget);
    };
  }, []);
}

/**
 * After a page change, focus left on the menu link that was clicked would send
 * the first arrow along the sidebar. Hand it to the page area instead.
 */
function useFocusPageOnNavigate() {
  const pathname = usePathname();
  useEffect(() => {
    const main = document.querySelector<HTMLElement>('[data-nav-main]');
    const active = document.activeElement;
    if (!main || openDialogCount() > 0) return;
    if (active && active !== document.body && !active.closest('[data-nav-sidebar]')) return;
    if (!main.hasAttribute('tabindex')) main.tabIndex = -1;
    main.focus({ preventScroll: true });
  }, [pathname]);
}

export function KeyboardNav() {
  useKeyboardNav();
  useFocusPageOnNavigate();
  return null;
}
