import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ZeroResultsTable } from './zero-results-table';

afterEach(() => { cleanup(); });

describe('ZeroResultsTable', () => {
  it('lists the searches with their counts and last day', () => {
    render(
      <ZeroResultsTable
        rows={[{ normalized: 'fendar', searches: 12, lastDay: '2026-11-19' }, { normalized: 'गियर बॉक्स', searches: 3, lastDay: '2026-11-02' }]}
        onMakeSynonym={() => {}}
      />,
    );
    const row = screen.getByText('fendar').closest('tr')!;
    expect(within(row).getByText('12')).not.toBeNull();
    expect(within(row).getByText('19 Nov 2026')).not.toBeNull();
    expect(within(screen.getByText('गियर बॉक्स').closest('tr')!).getByText('2 Nov 2026')).not.toBeNull();
  });

  it('"Make a synonym" hands over the search text', async () => {
    const user = userEvent.setup();
    const onMakeSynonym = vi.fn();
    render(<ZeroResultsTable rows={[{ normalized: 'fendar', searches: 12, lastDay: '2026-11-19' }]} onMakeSynonym={onMakeSynonym} />);
    await user.click(screen.getByRole('button', { name: 'Make a synonym of fendar' }));
    expect(onMakeSynonym).toHaveBeenCalledWith('fendar');
  });

  it('says when every search found something', () => {
    render(<ZeroResultsTable rows={[]} onMakeSynonym={() => {}} />);
    expect(screen.getByText('Every search in the last 30 days found something')).not.toBeNull();
  });
});
