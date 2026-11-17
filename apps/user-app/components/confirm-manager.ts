export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** A third button between confirm and cancel. Only choose() shows it. */
  secondaryLabel?: string;
  destructive?: boolean;
  /** A yes/no prompt with the confirm button only; the backdrop and back still cancel. */
  hideCancel?: boolean;
  /**
   * Choice cards in place of the buttons: one is picked (the first at open) and a
   * single button confirms it, settling 'confirm' or 'secondary'. Only choose() uses them.
   */
  picks?: { value: 'confirm' | 'secondary'; title: string; amount: string | null; detail: string }[];
  /** With picks: the button's label for each card. */
  confirmLabels?: Partial<Record<'confirm' | 'secondary', string>>;
}

export type Choice = 'confirm' | 'secondary' | 'cancel';

export interface ConfirmManager {
  readonly visible: boolean;
  readonly options: ConfirmOptions | null;
  confirm(options: ConfirmOptions): Promise<boolean>;
  /** Which button was pressed. A dismissal (backdrop, back) is always 'cancel'. */
  choose(options: ConfirmOptions): Promise<Choice>;
  settle(value: boolean | 'secondary'): void;
}

/**
 * Pure (React-free) manager for a single confirmation prompt. `onChange` is
 * invoked whenever visibility changes so a React provider can re-render.
 * A confirm() while one is already open is dropped (resolves false), keeping the
 * first prompt — prevents stacked sheets from rapid taps.
 */
export function createConfirmManager(onChange: () => void): ConfirmManager {
  let pending: { resolve: (v: Choice) => void } | null = null;
  let current: ConfirmOptions | null = null;

  const choose = (options: ConfirmOptions): Promise<Choice> => {
    if (pending) return Promise.resolve<Choice>('cancel');
    current = options;
    const p = new Promise<Choice>((resolve) => { pending = { resolve }; });
    onChange();
    return p;
  };

  return {
    get visible() { return pending !== null; },
    get options() { return current; },
    // A yes/no prompt has no third button to press.
    confirm: (options: ConfirmOptions): Promise<boolean> =>
      choose({ ...options, secondaryLabel: undefined }).then((c) => c === 'confirm'),
    choose,
    settle(value: boolean | 'secondary'): void {
      const p = pending;
      pending = null;
      current = null;
      onChange();
      p?.resolve(value === 'secondary' ? 'secondary' : value ? 'confirm' : 'cancel');
    },
  };
}
