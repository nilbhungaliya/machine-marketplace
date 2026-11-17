import type { ToastShowParams } from 'react-native-toast-message';

/**
 * Lets a toast outlive the sheet that showed it. Recorded at `show` time, not
 * on render: RN's `Modal` returns null the moment `visible` goes false, so a
 * sheet that toasts and closes in one tick deletes the toast before it renders.
 */

/** The library's own default `visibilityTime`. */
export const DEFAULT_VISIBLE_MS = 4000;

type Shown = { params: ToastShowParams; shownAt: number; durationMs: number };

let shown: Shown | null = null;

export function recordShown(params: ToastShowParams, now: number = Date.now()): void {
  shown = { params, shownAt: now, durationMs: params.visibilityTime ?? DEFAULT_VISIBLE_MS };
}

/** Matched on the copy — that is all the card knows about itself. */
export function clearShown(text1?: string, text2?: string): void {
  if (shown?.params.text1 === text1 && shown?.params.text2 === text2) shown = null;
}

export function takePending(now: number = Date.now()): ToastShowParams | null {
  const current = shown;
  shown = null;
  if (!current) return null;
  const remaining = current.durationMs - (now - current.shownAt);
  if (remaining <= 0) return null;
  return { ...current.params, visibilityTime: remaining };
}

/** Tests only — module state outlives a single test. */
export function __resetHandoff(): void {
  shown = null;
}
