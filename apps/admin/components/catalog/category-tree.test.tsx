import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SIDE_CONVENTION, type CatalogLevel, type CategoryNode } from '@mpm/shared-types';

vi.mock('@/lib/catalog-api', () => ({ reorderSiblings: vi.fn().mockResolvedValue(null) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { reorderSiblings } from '@/lib/catalog-api';
import { ApiError } from '@/lib/api';
import { toast } from 'sonner';
import { CategoryTree } from './category-tree';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function node(
  id: string, name: string, level: CatalogLevel, children: CategoryNode[] = [],
  over: Partial<CategoryNode> = {},
): CategoryNode {
  return {
    id, parentId: null, level, name, slug: id, path: id, icon: null, sortOrder: 0, isActive: true,
    hasSides: null, sideConvention: null, effectiveHasSides: false, effectiveSideConvention: DEFAULT_SIDE_CONVENTION,
    children: children.map((c) => ({ ...c, parentId: id })),
    ...over,
  };
}

const tree: CategoryNode[] = [
  node('sewing', 'Sewing', 'machine_category', [
    node('multi', 'Multi Head Embroidery', 'machine_type', [
      node('hooks', 'Rotary Hooks', 'part_group', [], { effectiveHasSides: true }),
      node('needles', 'Needles', 'part_group'),
    ]),
    node('lock', 'Lockstitch', 'machine_type'),
  ]),
  node('weaving', 'Weaving', 'machine_category'),
  node('old', 'Old category', 'machine_category', [], { isActive: false }),
];

function renderTree(props: Partial<React.ComponentProps<typeof CategoryTree>> = {}) {
  const onSelect = vi.fn();
  const onReordered = vi.fn();
  render(<CategoryTree nodes={tree} selectedId={null} onSelect={onSelect} query="" onReordered={onReordered} {...props} />);
  return { onSelect, onReordered };
}

const row = (name: string) => screen.getByText(name).closest('[data-tree-row]') as HTMLElement;

describe('CategoryTree', () => {
  it('renders the category names, collapsed', () => {
    renderTree();
    expect(screen.getByText('Sewing')).not.toBeNull();
    expect(screen.getByText('Weaving')).not.toBeNull();
    expect(screen.queryByText('Multi Head Embroidery')).toBeNull();
  });

  it('clicking a category selects it and shows its machine types', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderTree();
    await user.click(screen.getByText('Sewing'));
    expect(onSelect).toHaveBeenCalledWith('sewing');
    expect(screen.getByText('Multi Head Embroidery')).not.toBeNull();
    expect(screen.getByText('Lockstitch')).not.toBeNull();
  });

  it('labels each row with its level', () => {
    renderTree({ selectedId: 'hooks' });
    expect(row('Sewing').getAttribute('title')).toBe('Category');
    expect(row('Multi Head Embroidery').getAttribute('title')).toBe('Machine type');
    expect(row('Rotary Hooks').getAttribute('title')).toBe('Part group');
  });

  it('shows an "Off" badge on an inactive node', () => {
    renderTree();
    expect(within(row('Old category')).getByText('Off')).not.toBeNull();
    expect(within(row('Weaving')).queryByText('Off')).toBeNull();
  });

  it('marks a part group whose effective side setting is on with "L | R"', () => {
    renderTree({ selectedId: 'hooks' });
    expect(within(row('Rotary Hooks')).getByText('L | R')).not.toBeNull();
    expect(within(row('Needles')).queryByText('L | R')).toBeNull();
  });

  it('move down on the first of three siblings sends [second, first, third]', async () => {
    const user = userEvent.setup();
    const { onReordered } = renderTree();
    await user.click(screen.getByRole('button', { name: 'Move Sewing down' }));
    expect(reorderSiblings).toHaveBeenCalledWith(null, ['weaving', 'sewing', 'old']);
    await waitFor(() => expect(onReordered).toHaveBeenCalled());
  });

  it('move up is disabled on the first row and move down on the last', () => {
    renderTree();
    expect((screen.getByRole('button', { name: 'Move Sewing up' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Move Old category down' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('with a search that hides the second sibling, move down still sends all three ids', async () => {
    const user = userEvent.setup();
    // "o" matches Old category and Sewing's machine types (Embroidery, Lockstitch), not Weaving.
    renderTree({ query: 'o' });
    expect(screen.queryByText('Weaving')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Move Sewing down' }));
    expect(reorderSiblings).toHaveBeenCalledWith(null, ['weaving', 'sewing', 'old']);
  });

  it('on STALE_ORDER, says so and reloads the tree', async () => {
    const user = userEvent.setup();
    vi.mocked(reorderSiblings).mockRejectedValueOnce(new ApiError('The list has changed', 409, 'STALE_ORDER'));
    const { onReordered } = renderTree();
    await user.click(screen.getByRole('button', { name: 'Move Sewing down' }));
    await waitFor(() => expect(onReordered).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith('Someone changed this list; reloaded');
  });

  it('keeps the reorder buttons disabled until the reloaded tree has arrived', async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    const onReordered = vi.fn(() => new Promise<void>((r) => { finish = r; }));
    renderTree({ onReordered });
    await user.click(screen.getByRole('button', { name: 'Move Sewing down' }));
    await waitFor(() => expect(onReordered).toHaveBeenCalled());
    const weavingUp = screen.getByRole('button', { name: 'Move Weaving up' }) as HTMLButtonElement;
    expect(weavingUp.disabled).toBe(true);
    await act(async () => { finish(); });
    expect(weavingUp.disabled).toBe(false);
  });
});
