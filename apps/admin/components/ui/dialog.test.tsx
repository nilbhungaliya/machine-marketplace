import { useState, type ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider, useConfirm } from '@/components/confirm-provider';
import { Dialog } from './dialog';
import { FormDialog } from './form-dialog';

// jsdom has no layout, so offsetParent is always null. The dialog uses it to skip
// elements that are not rendered; stand in with "no display:none on the way up".
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) {
      for (let el: HTMLElement | null = this; el; el = el.parentElement) {
        if (el.style.display === 'none') return null;
      }
      return this.parentElement;
    },
  });
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

function Page() {
  const [first, setFirst] = useState(false);
  const [second, setSecond] = useState(false);
  const [opener, setOpener] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setFirst(true)}>Open</button>
      <Dialog open={first} onClose={() => setFirst(false)} title="First">
        <button type="button" style={{ display: 'none' }}>Invisible</button>
        <input type="hidden" name="h" />
        <button type="button" tabIndex={-1}>Roving early</button>
        <button type="button">One</button>
        {opener && <button type="button" onClick={() => setSecond(true)}>Open second</button>}
        <button type="button" tabIndex={-1}>Roving late</button>
      </Dialog>
      <Dialog open={second} onClose={() => setSecond(false)} title="Second">
        <button type="button" onClick={() => setFirst(false)}>Close first</button>
        <button type="button" onClick={() => setOpener(false)}>Hide opener</button>
      </Dialog>
    </>
  );
}

const dialog = (name: string) => screen.queryByRole('dialog', { name });

describe('Dialog', () => {
  it('starts focus on the first visible control, skipping close, hidden and tabindex=-1', async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByText('Open'));
    expect(dialog('First')).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByText('One'));
    expect(dialog('First')!.contains(document.activeElement)).toBe(true);
  });

  it('wraps Tab and Shift+Tab inside the dialog, skipping tabindex=-1', async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByText('Open'));
    const close = screen.getByRole('button', { name: 'Close' });
    const last = screen.getByText('Open second');

    last.focus();
    await user.tab();
    expect(document.activeElement).toBe(close);

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(last);
  });

  it('closes only the top dialog on Escape, then returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<Page />);
    const trigger = screen.getByText('Open');
    await user.click(trigger);
    await user.click(screen.getByText('Open second'));
    expect(dialog('Second')).not.toBeNull();
    expect(dialog('Second')!.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');
    expect(dialog('Second')).toBeNull();
    expect(dialog('First')).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByText('Open second'));

    await user.keyboard('{Escape}');
    expect(dialog('First')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('locks page scroll while any dialog is open and restores the original value after the last', async () => {
    const user = userEvent.setup();
    document.body.style.overflow = 'scroll';
    render(<Page />);
    await user.click(screen.getByText('Open'));
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('scroll');
  });

  it('closing a lower dialog first neither unlocks scroll nor steals focus from the top one', async () => {
    const user = userEvent.setup();
    document.body.style.overflow = 'scroll';
    render(<Page />);
    await user.click(screen.getByText('Open'));
    await user.click(screen.getByText('Open second'));

    await user.click(screen.getByText('Close first'));
    expect(dialog('First')).toBeNull();
    expect(dialog('Second')).not.toBeNull();
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.activeElement).toBe(screen.getByText('Close first'));

    await user.keyboard('{Escape}');
    expect(dialog('Second')).toBeNull();
    expect(document.body.style.overflow).toBe('scroll');
  });

  it('when the opener inside the lower dialog is gone, focus lands inside that dialog', async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByText('Open'));
    await user.click(screen.getByText('Open second'));
    await user.click(screen.getByText('Hide opener'));
    expect(screen.queryByText('Open second')).toBeNull();

    await user.keyboard('{Escape}');
    expect(dialog('Second')).toBeNull();
    expect(dialog('First')!.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(screen.getByText('One'));
  });

  it('after the lower dialog closes first, closing the top one returns focus to the page trigger', async () => {
    const user = userEvent.setup();
    render(<Page />);
    const trigger = screen.getByText('Open');
    await user.click(trigger);
    await user.click(screen.getByText('Open second'));
    await user.click(screen.getByText('Close first'));

    await user.keyboard('{Escape}');
    expect(dialog('Second')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('a footer control marked data-autofocus gets first focus over the first body control', async () => {
    const user = userEvent.setup();
    function Auto() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open auto</button>
          <Dialog
            open={open}
            onClose={() => setOpen(false)}
            title="Auto"
            footer={<button type="button" data-autofocus>Safe choice</button>}
          >
            <input aria-label="Body field" />
          </Dialog>
        </>
      );
    }
    render(<Auto />);
    await user.click(screen.getByText('Open auto'));
    expect(document.activeElement).toBe(screen.getByText('Safe choice'));
  });

  it('when not dismissible, ignores the backdrop and Escape but the X still closes', async () => {
    const user = userEvent.setup();
    function Sticky() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open sticky</button>
          <Dialog open={open} onClose={() => setOpen(false)} title="Sticky" dismissible={false}>
            <input aria-label="Reason" />
          </Dialog>
        </>
      );
    }
    render(<Sticky />);
    await user.click(screen.getByText('Open sticky'));
    const backdrop = document.body.querySelector('[aria-hidden].fixed') as HTMLElement;
    expect(backdrop).not.toBeNull();
    await user.click(backdrop);
    expect(dialog('Sticky')).not.toBeNull();
    await user.keyboard('{Escape}');
    expect(dialog('Sticky')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(dialog('Sticky')).toBeNull();
  });

  it('a dismissible dialog closes on a backdrop click', async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByText('Open'));
    await user.click(document.body.querySelector('[aria-hidden].fixed') as HTMLElement);
    expect(dialog('First')).toBeNull();
  });

  it('Escape on a confirm opened over a non-dismissible dialog closes only the confirm', async () => {
    const user = userEvent.setup();
    function Stacked() {
      const [form, setForm] = useState(false);
      const [confirm, setConfirm] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setForm(true)}>Open form</button>
          <Dialog open={form} onClose={() => setForm(false)} title="Form" dismissible={false}>
            <button type="button" onClick={() => setConfirm(true)}>Ask</button>
          </Dialog>
          <Dialog
            open={confirm}
            onClose={() => setConfirm(false)}
            title="Sure?"
            size="sm"
            footer={<button type="button" data-autofocus>Cancel</button>}
          >
            <p>Discard changes?</p>
          </Dialog>
        </>
      );
    }
    render(<Stacked />);
    await user.click(screen.getByText('Open form'));
    await user.click(screen.getByText('Ask'));
    expect(dialog('Sure?')).not.toBeNull();

    await user.keyboard('{Escape}');
    expect(dialog('Sure?')).toBeNull();
    expect(dialog('Form')).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByText('Ask'));

    await user.keyboard('{Escape}');
    expect(dialog('Form')).not.toBeNull();
  });
});

describe('Dialog Enter', () => {
  function Primary({ onSave, onCancel = () => {}, disabled = false, busy = false, children }: {
    onSave: () => void;
    onCancel?: () => void;
    disabled?: boolean;
    busy?: boolean;
    children?: ReactNode;
  }) {
    return (
      <Dialog
        open
        onClose={() => {}}
        title="Edit"
        footer={(
          <>
            <button type="button" onClick={onCancel}>Cancel</button>
            <button type="button" data-dialog-primary disabled={disabled} aria-busy={busy || undefined} onClick={onSave}>Save</button>
          </>
        )}
      >
        {children ?? <input aria-label="Name" />}
      </Dialog>
    );
  }

  it('Enter in a text field clicks the data-dialog-primary button once', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<Primary onSave={onSave} />);
    expect(document.activeElement).toBe(screen.getByLabelText('Name'));
    await user.keyboard('{Enter}');
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('modifier keys and auto-repeat do not fire it', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<Primary onSave={onSave} />);
    await user.keyboard('{Shift>}{Enter}{/Shift}{Control>}{Enter}{/Control}{Meta>}{Enter}{/Meta}');
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Enter', repeat: true });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('leaves Enter to a textarea, select, combobox, an ignored region and a focused button', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(
      <Primary onSave={onSave} onCancel={onCancel}>
        <textarea aria-label="Note" />
        <select aria-label="Pick"><option>a</option></select>
        <input aria-label="Search" role="combobox" aria-expanded="false" aria-controls="search-list" />
        <div data-enter="ignore"><input aria-label="Place" /></div>
        <div data-enter-ignore><input aria-label="Place 2" /></div>
      </Primary>,
    );
    for (const label of ['Note', 'Pick', 'Search', 'Place', 'Place 2']) {
      screen.getByLabelText(label).focus();
      await user.keyboard('{Enter}');
    }
    expect(onSave).not.toHaveBeenCalled();
    screen.getByText('Cancel').focus();
    await user.keyboard('{Enter}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('ignores the Enter that commits an IME composition', () => {
    const onSave = vi.fn();
    render(<Primary onSave={onSave} />);
    const input = screen.getByLabelText('Name');
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('does not press a disabled or busy primary', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const { rerender } = render(<Primary onSave={onSave} disabled />);
    await user.keyboard('{Enter}');
    rerender(<Primary onSave={onSave} busy />);
    screen.getByLabelText('Name').focus();
    await user.keyboard('{Enter}');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('an explicit onEnter wins over the marked button', async () => {
    const user = userEvent.setup();
    const onEnter = vi.fn();
    const onSave = vi.fn();
    render(
      <Dialog open onClose={() => {}} title="Explicit" onEnter={onEnter} footer={<button type="button" data-dialog-primary onClick={onSave}>Save</button>}>
        <input aria-label="Name" />
      </Dialog>,
    );
    await user.keyboard('{Enter}');
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('only the top dialog reacts', async () => {
    const user = userEvent.setup();
    const lower = vi.fn();
    const upper = vi.fn();
    render(
      <>
        <Dialog open onClose={() => {}} title="Lower" footer={<button type="button" data-dialog-primary onClick={lower}>Save lower</button>}>
          <input aria-label="Lower field" />
        </Dialog>
        <Dialog open onClose={() => {}} title="Upper" footer={<button type="button" data-dialog-primary onClick={upper}>Save upper</button>}>
          <input aria-label="Upper field" />
        </Dialog>
      </>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText('Upper field'));
    await user.keyboard('{Enter}');
    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();
    // Focus somehow in the lower one: still not its turn.
    screen.getByLabelText('Lower field').focus();
    await user.keyboard('{Enter}');
    expect(lower).not.toHaveBeenCalled();
  });

  it('with nothing to fill in, focus starts on the primary so Enter presses it', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<Primary onSave={onSave}><p>Sure?</p></Primary>);
    expect(document.activeElement).toBe(screen.getByText('Save'));
    await user.keyboard('{Enter}');
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('FormDialog: Enter on a checkbox submits once', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <ConfirmProvider>
        <FormDialog open onClose={() => {}} title="Form" dirty={false} submitLabel="Save" onSubmit={onSubmit}>
          <input type="checkbox" aria-label="Active" />
        </FormDialog>
      </ConfirmProvider>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText('Active'));
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText('Active') as HTMLInputElement).checked).toBe(false);
  });

  it('FormDialog: Enter does nothing while submit is disabled', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <ConfirmProvider>
        <FormDialog open onClose={() => {}} title="Form" dirty={false} submitLabel="Save" submitDisabled onSubmit={onSubmit}>
          <input aria-label="Name" />
        </FormDialog>
      </ConfirmProvider>,
    );
    await user.keyboard('{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  function AskConfirm({ onResult }: { onResult: (ok: boolean) => void }) {
    const confirm = useConfirm();
    return <button type="button" onClick={() => { void confirm({ title: 'Delete it?', variant: 'danger', confirmLabel: 'Delete' }).then(onResult); }}>Ask</button>;
  }

  it('ConfirmDialog: Enter confirms', async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(<ConfirmProvider><AskConfirm onResult={onResult} /></ConfirmProvider>);
    await user.click(screen.getByText('Ask'));
    expect(dialog('Delete it?')).not.toBeNull();
    await user.keyboard('{Enter}');
    expect(dialog('Delete it?')).toBeNull();
    expect(onResult).toHaveBeenCalledWith(true);
  });

  it('a confirm over a form: Enter confirms only, the form is not submitted', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onResult = vi.fn();
    render(
      <ConfirmProvider>
        <FormDialog open onClose={() => {}} title="Form" dirty={false} submitLabel="Save" onSubmit={onSubmit}>
          <input aria-label="Name" />
          <AskConfirm onResult={onResult} />
        </FormDialog>
      </ConfirmProvider>,
    );
    await user.click(screen.getByText('Ask'));
    await user.keyboard('{Enter}');
    expect(onResult).toHaveBeenCalledWith(true);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(dialog('Form')).not.toBeNull();
  });

  it('a held (repeat) Enter never presses the focused primary', async () => {
    const onSave = vi.fn();
    render(<Primary onSave={onSave}><p>Sure?</p></Primary>);
    const save = screen.getByText('Save');
    expect(document.activeElement).toBe(save);
    // fireEvent returns false when the default (native activation) was prevented.
    expect(fireEvent.keyDown(save, { key: 'Enter', repeat: true })).toBe(false);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('Enter with focus fallen to <body> still runs the primary', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<Primary onSave={onSave} />);
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    await user.keyboard('{Enter}');
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('FormDialog: Enter in a text field submits exactly once', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <ConfirmProvider>
        <FormDialog open onClose={() => {}} title="Form" dirty={false} submitLabel="Save" onSubmit={onSubmit}>
          <input aria-label="Name" />
          <input aria-label="Phone" />
        </FormDialog>
      </ConfirmProvider>,
    );
    await user.type(screen.getByLabelText('Name'), 'Asha{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('a danger confirm starts focus on its panel; a fresh Enter confirms', async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(<ConfirmProvider><AskConfirm onResult={onResult} /></ConfirmProvider>);
    await user.click(screen.getByText('Ask'));
    expect(document.activeElement).toBe(dialog('Delete it?'));
    expect(fireEvent.keyDown(document.activeElement!, { key: 'Enter', repeat: true })).toBe(false);
    expect(dialog('Delete it?')).not.toBeNull();
    await user.keyboard('{Enter}');
    expect(onResult).toHaveBeenCalledWith(true);
  });

  it('"Discard this form?": focus starts on Keep editing and Enter keeps the form', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    render(
      <ConfirmProvider>
        <FormDialog open onClose={onClose} title="Form" dirty submitLabel="Save" onSubmit={onSubmit}>
          <input aria-label="Name" />
        </FormDialog>
      </ConfirmProvider>,
    );
    await user.keyboard('{Escape}');
    expect(dialog('Discard this form?')).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByText('Keep editing'));
    await user.keyboard('{Enter}');
    expect(dialog('Discard this form?')).toBeNull();
    expect(dialog('Form')).not.toBeNull();

    // From the panel itself, Enter is still the safe choice.
    await user.keyboard('{Escape}');
    dialog('Discard this form?')!.focus();
    await user.keyboard('{Enter}');
    expect(dialog('Discard this form?')).toBeNull();
    expect(dialog('Form')).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
