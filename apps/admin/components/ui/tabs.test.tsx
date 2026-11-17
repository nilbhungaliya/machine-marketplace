import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs } from './tabs';

afterEach(cleanup);

const items = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
] as const;

describe('Tabs', () => {
  it('ArrowRight on the selected tab selects the next one', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs items={[...items]} value="a" onChange={onChange} />);
    screen.getByRole('tab', { name: 'Alpha' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('wraps from the last tab to the first', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs items={[...items]} value="c" onChange={onChange} />);
    screen.getByRole('tab', { name: 'Gamma' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('a');
  });
});
