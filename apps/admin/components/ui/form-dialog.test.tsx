import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider, useConfirm } from '@/components/confirm-provider';
import { FormDialog } from './form-dialog';

// jsdom has no layout, so offsetParent is always null (see dialog.test.tsx).
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

type Props = {
  dirty?: boolean;
  submitting?: boolean;
  submitDisabled?: boolean;
  onSubmit?: () => void | Promise<void>;
  onClose?: () => void;
  discardMessage?: string;
};

function Harness({ dirty = false, submitting = false, submitDisabled = false, onSubmit = () => {}, onClose, discardMessage }: Props) {
  const [open, setOpen] = useState(true);
  return (
    <FormDialog
      open={open}
      onClose={() => { onClose?.(); setOpen(false); }}
      title="Add agent"
      dirty={dirty}
      submitting={submitting}
      submitDisabled={submitDisabled}
      submitLabel="Save agent"
      onSubmit={onSubmit}
      discardMessage={discardMessage}
      extraFooter={<button type="button">Preview</button>}
    >
      <input aria-label="Name" />
      <AskButton />
    </FormDialog>
  );
}

/** A page-level confirm opened from inside the form. */
function AskButton() {
  const confirm = useConfirm();
  return <button type="button" onClick={() => { void confirm({ title: 'Page confirm?' }); }}>Ask</button>;
}

const renderForm = (props: Props = {}) => render(<ConfirmProvider><Harness {...props} /></ConfirmProvider>);
const dialog = (name: string) => screen.queryByRole('dialog', { name });
const backdrop = () => document.body.querySelector('[aria-hidden].fixed') as HTMLElement;

describe('FormDialog', () => {
  it('renders the title, the fields and a footer with Cancel and the submit label', () => {
    renderForm();
    expect(dialog('Add agent')).not.toBeNull();
    expect(screen.getByLabelText('Name')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Save agent' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Preview' })).not.toBeNull();
  });

  it('Enter in a text field submits once; clicking submit submits once', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm({ onSubmit });
    await user.type(screen.getByLabelText('Name'), 'Asha{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Save agent' }));
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('submitDisabled blocks both Enter and the button', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm({ onSubmit, submitDisabled: true });
    await user.type(screen.getByLabelText('Name'), 'Asha{Enter}');
    await user.click(screen.getByRole('button', { name: 'Save agent' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  describe('clean form closes without asking', () => {
    const ways: Array<[string, (user: ReturnType<typeof userEvent.setup>) => Promise<void>]> = [
      ['Escape', (user) => user.keyboard('{Escape}')],
      ['X', (user) => user.click(screen.getByRole('button', { name: 'Close' }))],
      ['backdrop', (user) => user.click(backdrop())],
      ['Cancel', (user) => user.click(screen.getByRole('button', { name: 'Cancel' }))],
    ];
    for (const [name, act] of ways) {
      it(name, async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        renderForm({ onClose });
        await act(user);
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(dialog('Discard this form?')).toBeNull();
        expect(dialog('Add agent')).toBeNull();
      });
    }
  });

  describe('dirty form asks before discarding', () => {
    const ways: Array<[string, (user: ReturnType<typeof userEvent.setup>) => Promise<void>]> = [
      ['Escape', (user) => user.keyboard('{Escape}')],
      ['X', (user) => user.click(screen.getByRole('button', { name: 'Close' }))],
      ['backdrop', (user) => user.click(backdrop())],
      ['Cancel', (user) => user.click(screen.getByRole('button', { name: 'Cancel' }))],
    ];
    for (const [name, act] of ways) {
      it(`${name}: Keep editing keeps it open, Discard closes`, async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        renderForm({ dirty: true, onClose });

        await act(user);
        expect(dialog('Discard this form?')).not.toBeNull();
        await user.click(screen.getByRole('button', { name: 'Keep editing' }));
        expect(dialog('Discard this form?')).toBeNull();
        expect(dialog('Add agent')).not.toBeNull();
        expect(onClose).not.toHaveBeenCalled();

        await act(user);
        await user.click(await screen.findByRole('button', { name: 'Discard' }));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(dialog('Add agent')).toBeNull();
      });
    }
  });

  it('while submitting: spinner on a disabled submit, and Escape, backdrop, X, Cancel and Enter do nothing', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    renderForm({ submitting: true, dirty: true, onClose, onSubmit });
    const submit = screen.getByRole('button', { name: 'Save agent' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(submit.querySelector('.animate-spin')).not.toBeNull();

    await user.keyboard('{Escape}');
    await user.click(backdrop());
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.type(screen.getByLabelText('Name'), 'x{Enter}');
    // A disabled default button never submits on Enter, so also submit the form directly to test the guard itself.
    fireEvent.submit(screen.getByLabelText('Name').closest('form')!);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(dialog('Discard this form?')).toBeNull();
    expect(dialog('Add agent')).not.toBeNull();
  });

  it('a confirm opened from inside the form closes alone on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderForm({ onClose });
    await user.click(screen.getByText('Ask'));
    expect(dialog('Page confirm?')).not.toBeNull();

    await user.keyboard('{Escape}');
    expect(dialog('Page confirm?')).toBeNull();
    expect(dialog('Add agent')).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  describe('in-flight guard (parent has not set submitting)', () => {
    /** A submit that stays pending until the test settles it. */
    function pending() {
      let settle!: () => void;
      const fn = vi.fn(() => new Promise<void>((resolve) => { settle = resolve; }));
      return { fn, settle: () => act(async () => { settle(); }) };
    }

    it('two rapid Enter presses submit once', async () => {
      const user = userEvent.setup();
      const { fn, settle } = pending();
      renderForm({ onSubmit: fn });
      await user.type(screen.getByLabelText('Name'), 'Asha{Enter}{Enter}');
      expect(fn).toHaveBeenCalledTimes(1);
      await settle();
      await user.type(screen.getByLabelText('Name'), '{Enter}');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('a double click submits once', async () => {
      const { fn, settle } = pending();
      renderForm({ onSubmit: fn });
      const form = screen.getByLabelText('Name').closest('form')!;
      // Two submits in the same tick, before React re-renders.
      fireEvent.submit(form);
      fireEvent.submit(form);
      expect(fn).toHaveBeenCalledTimes(1);
      await userEvent.setup().dblClick(screen.getByRole('button', { name: 'Save agent' }));
      expect(fn).toHaveBeenCalledTimes(1);
      await settle();
    });

    it('while in flight: spinner on submit, and close requests are ignored', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      const { fn, settle } = pending();
      renderForm({ onSubmit: fn, onClose });
      await user.type(screen.getByLabelText('Name'), '{Enter}');
      const submit = screen.getByRole('button', { name: 'Save agent' }) as HTMLButtonElement;
      expect(submit.querySelector('.animate-spin')).not.toBeNull();
      expect(submit.getAttribute('aria-busy')).toBe('true');

      await user.click(submit);
      expect(fn).toHaveBeenCalledTimes(1);
      await user.keyboard('{Escape}');
      await user.click(backdrop());
      await user.click(screen.getByRole('button', { name: 'Close' }));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onClose).not.toHaveBeenCalled();
      expect(dialog('Add agent')).not.toBeNull();

      await settle();
      expect(submit.querySelector('.animate-spin')).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('a rejected submit clears the guard', async () => {
      const user = userEvent.setup();
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      const fn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
      renderForm({ onSubmit: fn });
      await user.type(screen.getByLabelText('Name'), '{Enter}');
      await user.type(screen.getByLabelText('Name'), '{Enter}');
      expect(fn).toHaveBeenCalledTimes(2);
      expect(logged).toHaveBeenCalled();
      logged.mockRestore();
    });

    it('a handler that awaits a confirm and then the API still runs once', async () => {
      const user = userEvent.setup();
      const apiCall = vi.fn(() => Promise.resolve());
      const submits = vi.fn();
      function ConfirmingForm() {
        const confirm = useConfirm();
        return (
          <FormDialog
            open
            onClose={() => {}}
            title="Add agent"
            dirty={false}
            submitLabel="Save agent"
            onSubmit={async () => {
              submits();
              if (!(await confirm({ title: 'Really save?', confirmLabel: 'Save' }))) return;
              await apiCall();
            }}
          >
            <input aria-label="Name" />
          </FormDialog>
        );
      }
      render(<ConfirmProvider><ConfirmingForm /></ConfirmProvider>);
      await user.type(screen.getByLabelText('Name'), 'Asha{Enter}');
      expect(dialog('Really save?')).not.toBeNull();
      // The form behind the confirm cannot submit again.
      fireEvent.submit(screen.getByLabelText('Name').closest('form')!);
      await user.click(screen.getByRole('button', { name: 'Save' }));
      expect(submits).toHaveBeenCalledTimes(1);
      expect(apiCall).toHaveBeenCalledTimes(1);
      expect(dialog('Really save?')).toBeNull();
    });
    it('cancelling a confirm the handler awaits releases the guard, so a second submit runs', async () => {
      const user = userEvent.setup();
      const submits = vi.fn();
      function ConfirmingForm() {
        const confirm = useConfirm();
        return (
          <FormDialog
            open
            onClose={() => {}}
            title="Add agent"
            dirty={false}
            submitLabel="Save agent"
            onSubmit={async () => {
              submits();
              await confirm({ title: 'Really save?', confirmLabel: 'Save' });
            }}
          >
            <input aria-label="Name" />
          </FormDialog>
        );
      }
      render(<ConfirmProvider><ConfirmingForm /></ConfirmProvider>);
      await user.click(screen.getByRole('button', { name: 'Save agent' }));
      expect(dialog('Really save?')).not.toBeNull();
      await user.click(within(dialog('Really save?')!).getByRole('button', { name: 'Cancel' }));
      expect(dialog('Really save?')).toBeNull();
      expect(submits).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole('button', { name: 'Save agent' }));
      expect(submits).toHaveBeenCalledTimes(2);
      expect(dialog('Really save?')).not.toBeNull();
    });
  });

  describe('discard message', () => {
    it('defaults to "What you typed will be lost."', async () => {
      const user = userEvent.setup();
      renderForm({ dirty: true });
      await user.keyboard('{Escape}');
      expect(screen.getByText('What you typed will be lost.')).not.toBeNull();
    });

    it('uses discardMessage when given', async () => {
      const user = userEvent.setup();
      renderForm({ dirty: true, discardMessage: 'Unsaved changes to this add-on will be lost.' });
      await user.keyboard('{Escape}');
      expect(screen.getByText('Unsaved changes to this add-on will be lost.')).not.toBeNull();
      expect(screen.queryByText('What you typed will be lost.')).toBeNull();
    });
  });

  it('a confirm from inside onSubmit takes focus; Escape closes only it and focus returns to the field', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    function PageForm() {
      const confirm = useConfirm();
      return (
        <FormDialog
          open
          onClose={onClose}
          title="Add agent"
          dirty
          submitLabel="Save agent"
          onSubmit={async () => { await confirm({ title: 'Create this agent?', confirmLabel: 'Create' }); }}
        >
          <input aria-label="Phone" />
        </FormDialog>
      );
    }
    render(<ConfirmProvider><PageForm /></ConfirmProvider>);
    const phone = screen.getByLabelText('Phone');
    await user.click(phone);
    await user.keyboard('{Enter}');
    const confirmDialog = dialog('Create this agent?')!;
    expect(confirmDialog).not.toBeNull();
    expect(confirmDialog.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');
    expect(dialog('Create this agent?')).toBeNull();
    expect(dialog('Discard this form?')).toBeNull();
    expect(dialog('Add agent')).not.toBeNull();
    expect(document.activeElement).toBe(phone);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('clicking submit, then cancelling the handler confirm, puts focus back on the submit button', async () => {
    const user = userEvent.setup();
    function PageForm() {
      const confirm = useConfirm();
      return (
        <FormDialog
          open
          onClose={() => {}}
          title="Add agent"
          dirty={false}
          submitLabel="Save agent"
          onSubmit={async () => { await confirm({ title: 'Create this agent?', confirmLabel: 'Create' }); }}
        >
          <input aria-label="Phone" />
        </FormDialog>
      );
    }
    render(<ConfirmProvider><PageForm /></ConfirmProvider>);
    const submit = screen.getByRole('button', { name: 'Save agent' });
    await user.click(submit);
    expect(dialog('Create this agent?')).not.toBeNull();
    await user.keyboard('{Escape}');
    expect(dialog('Create this agent?')).toBeNull();
    expect(document.activeElement).toBe(submit);
    expect(submit.querySelector('.animate-spin')).toBeNull();
  });
});
