'use client';

import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import ModalBackdrop from '@/components/modal-backdrop';
import { cn } from '@/lib/utils';

const WIDTH = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' } as const;

// Elements with tabindex="-1" (e.g. the unselected roving Tabs buttons) are not Tab stops.
const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type=hidden])',
  'select:not([disabled])', 'textarea:not([disabled])', 'video[controls]', '[tabindex]',
].map((sel) => `${sel}:not([tabindex="-1"])`).join(', ');

/** Tab stops inside the panel that are actually rendered. */
function focusables(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
}

type StackEntry = {
  id: string;
  opener: HTMLElement | null;
  /** Openers inherited from dialogs below that closed first, tried after `opener`. */
  fallbacks: Array<HTMLElement | null>;
  panel: { current: HTMLElement | null };
};

/** The open dialogs and what opened each, newest last. Only the top one handles Escape and Tab. */
const openStack: StackEntry[] = [];

/** How many dialogs are open right now, e.g. so a global shortcut stands back while one is. */
export function openDialogCount(): number {
  return openStack.length;
}

/** The top open dialog's panel, so arrow-key navigation can stay inside it. */
export function topDialogPanel(): HTMLElement | null {
  return openStack[openStack.length - 1]?.panel.current ?? null;
}

/** First control in the panel (the close X only if nothing else), else the panel itself. */
function focusInto(panel: HTMLElement) {
  const items = focusables(panel);
  (items.find((el) => !el.hasAttribute('data-dialog-close')) ?? items[0] ?? panel).focus({ preventScroll: true });
}

// Focus on one of these keeps Enter for itself: native activation, a newline,
// an open list. data-enter="ignore" (or data-enter-ignore) opts a region out, e.g. a places search box.
const OWN_ENTER = [
  'textarea', 'select', 'button', 'a[href]', 'summary', '[contenteditable]:not([contenteditable="false"])',
  'input[type=button]', 'input[type=submit]', 'input[type=reset]', 'input[type=image]', 'input[type=file]', 'input[type=color]',
  ...['button', 'link', 'option', 'combobox', 'listbox', 'tab', 'radio', 'checkbox', 'switch', 'menuitem',
    'menuitemradio', 'menuitemcheckbox', 'treeitem'].map((r) => `[role=${r}]`),
  '[data-enter="ignore"]', '[data-enter-ignore]',
].join(', ');

/** In the panel, or on <body> because the control holding focus went away. */
function inPanel(t: EventTarget | null, panel: HTMLElement | null): t is Element {
  if (!panel || !(t instanceof Element)) return false;
  return t === document.body || t === document.documentElement || panel.contains(t);
}

/** Whether this Enter should run the dialog's primary action rather than whatever has focus. */
function wantsEnter(e: KeyboardEvent, panel: HTMLElement | null): boolean {
  if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.defaultPrevented) return false;
  // The Enter that commits an IME candidate (Gujarati, Hindi keyboards); Safari reports keyCode 229.
  if (e.isComposing || e.keyCode === 229) return false;
  const t = e.target;
  if (!inPanel(t, panel)) return false;
  if (t === document.body || t === document.documentElement) return true;
  return !t.closest(OWN_ENTER) && !(t instanceof HTMLElement && t.isContentEditable);
}

/** The panel's [data-dialog-primary] button when it can be pressed now. */
function primaryButton(panel: HTMLElement | null): HTMLElement | null {
  const btn = panel?.querySelector<HTMLElement>('[data-dialog-primary]');
  if (!btn || (btn as HTMLButtonElement).disabled || btn.getAttribute('aria-disabled') === 'true'
    || btn.getAttribute('aria-busy') === 'true') return null;
  return btn;
}

/** Wraps Tab / Shift+Tab inside the panel so focus never leaves it. */
function trapTab(e: KeyboardEvent, panel: HTMLElement | null) {
  if (!panel) return;
  const items = focusables(panel);
  if (items.length === 0) { e.preventDefault(); panel.focus(); return; }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  const inside = active instanceof Node && panel.contains(active);
  if (e.shiftKey && (!inside || active === first || active === panel)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (!inside || active === last)) { e.preventDefault(); first.focus(); }
}

/**
 * Puts a popup on the shared dialog stack while `open`: only the top one handles
 * Escape (when dismissible), Enter (when `onEnter` is given; it returns whether it
 * acted) and traps Tab, and closing puts focus back where it was.
 * Call it in the component that mounts the panel, before the panel exists, so the
 * focused element it records is still the opener.
 */
export function useDialogLayer(
  open: boolean,
  panel: { current: HTMLElement | null },
  onClose: () => void,
  dismissible = true,
  onEnter?: () => boolean,
) {
  const id = useId();
  // Latest onClose without re-running the effects: an inline arrow from the
  // caller would otherwise re-add the listener on every render.
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  const onEnterRef = useRef(onEnter);
  useEffect(() => { onCloseRef.current = onClose; dismissibleRef.current = dismissible; onEnterRef.current = onEnter; });

  useEffect(() => {
    if (!open) return;
    // Runs before ModalBackdrop mounts the panel, so this is still the opener.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const entry: StackEntry = { id, opener, fallbacks: [], panel };
    openStack.push(entry);

    const onKey = (e: KeyboardEvent) => {
      // A confirm opened over a form dialog handles the keys alone.
      if (openStack[openStack.length - 1]?.id !== id) return;
      if (e.key === 'Escape') { if (dismissibleRef.current) onCloseRef.current(); }
      else if (e.key === 'Tab') trapTab(e, panel.current);
      else if (e.key === 'Enter' && onEnterRef.current) {
        // A held Enter that opened this dialog must not auto-repeat-press whatever now has focus.
        if (e.repeat && inPanel(e.target, panel.current)) e.preventDefault();
        // preventDefault also stops a form's own implicit submit, so it runs once.
        else if (wantsEnter(e, panel.current) && onEnterRef.current()) e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const i = openStack.indexOf(entry);
      if (i === -1) return;
      const wasTop = i === openStack.length - 1;
      openStack.splice(i, 1);
      // A lower one closing under an open confirm must not pull focus out of it,
      // but the dialog above inherits its openers for when it closes later.
      if (!wasTop) {
        openStack[i].fallbacks.push(entry.opener, ...entry.fallbacks);
        return;
      }
      const alive = (el: HTMLElement | null): el is HTMLElement => !!el && document.contains(el);
      const below = openStack[openStack.length - 1]?.panel.current;
      if (below) {
        // Still inside a dialog: back to the opener if it lives in that dialog,
        // otherwise into the dialog itself, never to a page control behind it.
        const back = [entry.opener, ...entry.fallbacks].find((el) => alive(el) && below.contains(el));
        if (back) back.focus({ preventScroll: true });
        else focusInto(below);
        return;
      }
      // The opener may be gone (e.g. its row re-rendered away): try the openers
      // inherited from dialogs that closed underneath this one.
      [entry.opener, ...entry.fallbacks].find(alive)?.focus({ preventScroll: true });
    };
  }, [open, id, panel]);
}

export function Dialog({ open, onClose, title, description, children, footer, size = 'md', dismissible = true, onEnter, focusPanel = false }: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof WIDTH;
  /** False: the backdrop and Escape do nothing, so a stray click cannot lose typed input. The X still closes. */
  dismissible?: boolean;
  /**
   * What Enter runs. Without it, Enter clicks the panel's [data-dialog-primary]
   * button unless that is disabled or busy. Enter on a textarea, select, button,
   * link or other control with its own Enter is left alone.
   */
  onEnter?: () => void;
  /** Start focus on the panel, not a button, so a fresh Enter goes through `onEnter`/the primary, e.g. a danger confirm. */
  focusPanel?: boolean;
}) {
  const titleId = useId();
  const panelNode = useRef<HTMLDivElement | null>(null);
  const onEnterRef = useRef(onEnter);
  const focusPanelRef = useRef(focusPanel);
  useEffect(() => { onEnterRef.current = onEnter; focusPanelRef.current = focusPanel; });
  const runPrimary = useCallback(() => {
    if (onEnterRef.current) { onEnterRef.current(); return true; }
    const btn = primaryButton(panelNode.current);
    if (!btn) return false;
    btn.click();
    return true;
  }, []);
  useDialogLayer(open, panelNode, onClose, dismissible, runPrimary);

  // Start focus inside the popup so keyboard users land on it. A callback ref,
  // because ModalBackdrop mounts the panel a render after Dialog's effects run.
  const panel = useCallback((node: HTMLDivElement | null) => {
    panelNode.current = node;
    if (!node) return;
    // data-autofocus picks a different start, e.g. the safe choice in a footer.
    // With nothing to fill in, start on the primary so Enter is its native click.
    const items = focusables(node);
    const first = items.find((el) => el.hasAttribute('data-autofocus'))
      ?? (focusPanelRef.current ? node : undefined)
      // Not a table row: Enter there opens the row, not the primary.
      ?? items.find((el) => !el.hasAttribute('data-dialog-close') && !el.closest('[data-dialog-footer]') && !el.hasAttribute('data-row-link'))
      ?? primaryButton(node)
      ?? items.find((el) => !el.hasAttribute('data-dialog-close'));
    (first ?? node).focus();
  }, []);

  if (!open) return null;
  return (
    <ModalBackdrop onClose={dismissible ? onClose : undefined}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn('relative flex max-h-[90vh] w-full flex-col rounded-[24px] bg-white shadow-xl outline-none', WIDTH[size])}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-5">
          <div>
            <h2 id={titleId} className="text-lg font-bold tracking-[-0.02em] text-gray-900">{title}</h2>
            {description && <div className="mt-1 text-sm text-gray-500">{description}</div>}
          </div>
          <button type="button" data-dialog-close onClick={onClose} aria-label="Close" className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-900">
            <X size={18} />
          </button>
        </div>
        {children && <div className="overflow-y-auto px-6 py-4">{children}</div>}
        {footer && <div data-dialog-footer className="flex justify-end gap-2 border-t border-gray-100 px-6 py-4">{footer}</div>}
        {!children && !footer && <div className="pb-5" />}
      </div>
    </ModalBackdrop>
  );
}
