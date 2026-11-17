import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import DataTable, { type Column } from './data-table';
import type { SortState } from '@/lib/use-client-list';

afterEach(cleanup);

type Row = { id: string; name: string; city: string };
const rows: Row[] = [
  { id: '1', name: 'Charlie', city: 'Surat' },
  { id: '2', name: 'Alpha', city: 'Rajkot' },
  { id: '3', name: 'Bravo', city: 'Vadodara' },
];
const columns: Column<Row>[] = [
  { key: 'name', header: 'Name', sortable: true },
  { key: 'city', header: 'City' },
];

const bodyNames = () =>
  screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent);

function Controlled({ onSortChange }: { onSortChange?: (s: SortState | null) => void }) {
  const [sort, setSort] = useState<SortState | null>(null);
  return (
    <DataTable
      columns={columns}
      data={rows}
      sort={sort}
      onSortChange={(s) => { setSort(s); onSortChange?.(s); }}
    />
  );
}

describe('DataTable sorting', () => {
  it('shows no sort state and keeps the given order until a header is clicked', () => {
    render(<Controlled />);
    expect(screen.getByRole('columnheader', { name: /name/i }).getAttribute('aria-sort')).toBe('none');
    expect(bodyNames()).toEqual(['Charlie', 'Alpha', 'Bravo']);
  });

  it('header click cycles asc → desc → none and reports each step', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Controlled onSortChange={spy} />);
    const th = screen.getByRole('columnheader', { name: /name/i });
    const btn = within(th).getByRole('button', { name: /name/i });
    await user.click(btn);
    expect(spy).toHaveBeenLastCalledWith({ key: 'name', dir: 'asc' });
    expect(th.getAttribute('aria-sort')).toBe('ascending');
    await user.click(btn);
    expect(spy).toHaveBeenLastCalledWith({ key: 'name', dir: 'desc' });
    expect(th.getAttribute('aria-sort')).toBe('descending');
    await user.click(btn);
    expect(spy).toHaveBeenLastCalledWith(null);
    expect(th.getAttribute('aria-sort')).toBe('none');
  });

  it('a different column starts at asc', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    const cols: Column<Row>[] = [columns[0], { key: 'city', header: 'City', sortable: true }];
    render(<DataTable columns={cols} data={rows} sort={{ key: 'name', dir: 'desc' }} onSortChange={spy} />);
    await user.click(screen.getByRole('button', { name: /city/i }));
    expect(spy).toHaveBeenCalledWith({ key: 'city', dir: 'asc' });
  });

  it('never reorders rows itself, whatever the sort says', () => {
    render(<DataTable columns={columns} data={rows} sort={{ key: 'name', dir: 'asc' }} onSortChange={() => {}} />);
    expect(bodyNames()).toEqual(['Charlie', 'Alpha', 'Bravo']);
  });

  it('non-sortable headers have no button and no aria-sort', () => {
    render(<Controlled />);
    const th = screen.getByRole('columnheader', { name: /city/i });
    expect(within(th).queryByRole('button')).toBeNull();
    expect(th.hasAttribute('aria-sort')).toBe(false);
  });

  it('a sortable column is inert when the owner gives no onSortChange', () => {
    render(<DataTable columns={columns} data={rows} />);
    const th = screen.getByRole('columnheader', { name: /name/i });
    expect(within(th).queryByRole('button')).toBeNull();
    expect(th.hasAttribute('aria-sort')).toBe(false);
  });
});

describe('DataTable toolbar and existing props', () => {
  it('renders the toolbar inside the card, also while loading', () => {
    const { rerender } = render(<DataTable columns={columns} data={rows} toolbar={<input aria-label="Search" />} />);
    expect(screen.getByRole('textbox', { name: 'Search' })).toBeTruthy();
    rerender(<DataTable columns={columns} data={rows} loading toolbar={<input aria-label="Search" />} />);
    expect(screen.getByRole('textbox', { name: 'Search' })).toBeTruthy();
  });

  it('loading shows the skeleton, not the rows', () => {
    render(<DataTable columns={columns} data={rows} loading />);
    expect(screen.queryByText('Charlie')).toBeNull();
  });

  it('empty data shows the empty message', () => {
    render(<DataTable columns={columns} data={[]} emptyMessage="No washers" />);
    expect(screen.getByText('No washers')).toBeTruthy();
  });

  it('row click and rowClassName still work', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(<DataTable columns={columns} data={rows} onRowClick={onRowClick} rowClassName={(r) => (r.id === '2' ? 'tinted' : '')} />);
    await user.click(screen.getByText('Alpha'));
    expect(onRowClick).toHaveBeenCalledWith(rows[1]);
    expect(screen.getByText('Alpha').closest('tr')?.className).toContain('tinted');
  });

  it('a sort click does not fire the row click', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(<DataTable columns={columns} data={rows} onRowClick={onRowClick} sort={null} onSortChange={() => {}} />);
    await user.click(screen.getByRole('button', { name: /name/i }));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('headerTitle becomes the header cell tooltip; without it there is none', () => {
    render(
      <DataTable
        columns={[
          { key: 'name', header: 'Name', headerTitle: 'Their full name' },
          { key: 'age', header: 'Age' },
        ]}
        data={[{ id: '1', name: 'Asha', age: 30 }]}
      />,
    );
    expect(screen.getByRole('columnheader', { name: 'Name' }).getAttribute('title')).toBe('Their full name');
    expect(screen.getByRole('columnheader', { name: 'Age' }).hasAttribute('title')).toBe(false);
  });

  it('pagination renders when onPageChange and total are given', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<DataTable columns={columns} data={rows} page={1} pageSize={3} total={9} onPageChange={onPageChange} itemLabel="washers" />);
    expect(screen.getAllByText(/washers/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: '2' }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});
