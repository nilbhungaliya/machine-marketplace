import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BrandWithModels, MachineModel } from '@mpm/shared-types';
import { ConfirmProvider } from '@/components/confirm-provider';

vi.mock('@/lib/catalog-api', () => ({
  updateBrand: vi.fn().mockResolvedValue(null),
  reorderBrands: vi.fn().mockResolvedValue(null),
  deleteBrand: vi.fn().mockResolvedValue(null),
  createBrand: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { reorderBrands, updateBrand } from '@/lib/catalog-api';
import { ApiError } from '@/lib/api';
import { toast } from 'sonner';
import { BrandsTable } from './brands-table';

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) { return this.parentElement; },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.style.overflow = '';
});

const model = (id: string, brandId: string, machineTypeId: string): MachineModel => ({
  id, key: id, brandId, machineTypeId, name: id.toUpperCase(), needsReview: false, sortOrder: 0, isActive: true,
});

function brand(id: string, name: string, over: Partial<BrandWithModels> = {}): BrandWithModels {
  return {
    id, key: id, name, slug: id, makesMachines: true, makesParts: false, needsReview: false, sortOrder: 0, isActive: true,
    models: [], ...over,
  };
}

const brands: BrandWithModels[] = [
  brand('tajima', 'Tajima', { makesParts: true, needsReview: true, models: [model('tmar', 'tajima', 'multi')] }),
  brand('groz', 'Groz-Beckert', { makesMachines: false, makesParts: true }),
  brand('toyota', 'Toyota', { needsReview: true, models: [model('lwt710', 'toyota', 'waterjet')] }),
];

const machineTypes = [
  { id: 'multi', label: 'Sewing › Multi Head Embroidery', isActive: true },
  { id: 'waterjet', label: 'Weaving › Water Jet Loom', isActive: true },
];

function renderTable() {
  const onSelect = vi.fn();
  const onChanged = vi.fn().mockResolvedValue(undefined);
  render(
    <ConfirmProvider>
      <BrandsTable brands={brands} machineTypes={machineTypes} selectedId={null} onSelect={onSelect} onChanged={onChanged} />
    </ConfirmProvider>,
  );
  return { onSelect, onChanged };
}

const row = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;

describe('BrandsTable', () => {
  it('renders the flags as badges', () => {
    renderTable();
    expect(within(row('Tajima')).getByText('Makes machines')).not.toBeNull();
    expect(within(row('Tajima')).getByText('Makes parts')).not.toBeNull();
    expect(within(row('Groz-Beckert')).queryByText('Makes machines')).toBeNull();
    expect(within(row('Groz-Beckert')).getByText('Makes parts')).not.toBeNull();
    expect(within(row('Tajima')).getByText('Needs review')).not.toBeNull();
    expect(within(row('Groz-Beckert')).queryByText('Needs review')).toBeNull();
  });

  it('"Needs review only" hides reviewed brands', async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(screen.getByLabelText('Needs review only'));
    expect(screen.queryByText('Groz-Beckert')).toBeNull();
    expect(screen.getByText('Tajima')).not.toBeNull();
    expect(screen.getByText('Toyota')).not.toBeNull();
  });

  it('the machine type filter keeps brands with a model of that type', async () => {
    const user = userEvent.setup();
    renderTable();
    await user.selectOptions(screen.getByLabelText('Machine type'), 'waterjet');
    expect(screen.getByText('Toyota')).not.toBeNull();
    expect(screen.queryByText('Tajima')).toBeNull();
    expect(screen.queryByText('Groz-Beckert')).toBeNull();
  });

  it('toggling Active calls updateBrand with { isActive: false }', async () => {
    const user = userEvent.setup();
    const { onChanged, onSelect } = renderTable();
    await user.click(within(row('Tajima')).getByRole('switch', { name: 'Tajima active' }));
    expect(updateBrand).toHaveBeenCalledWith('tajima', { isActive: false });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('move down on the first brand sends the full list with the first two swapped', async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(screen.getByRole('button', { name: 'Move Tajima down' }));
    expect(reorderBrands).toHaveBeenCalledWith(['groz', 'tajima', 'toyota']);
  });

  it('with "Needs review only" on, the move buttons are disabled', async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(screen.getByLabelText('Needs review only'));
    const down = screen.getByRole('button', { name: 'Move Tajima down' }) as HTMLButtonElement;
    const up = screen.getByRole('button', { name: 'Move Toyota up' }) as HTMLButtonElement;
    expect(down.disabled).toBe(true);
    expect(up.disabled).toBe(true);
    expect(down.title).toBe('Clear filters to reorder');
  });

  it('on STALE_ORDER, says so and reloads', async () => {
    const user = userEvent.setup();
    vi.mocked(reorderBrands).mockRejectedValueOnce(new ApiError('changed', 409, 'STALE_ORDER'));
    const { onChanged } = renderTable();
    await user.click(screen.getByRole('button', { name: 'Move Tajima down' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith('Someone changed this list; reloaded');
  });

  it('clicking a row selects the brand', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderTable();
    await user.click(screen.getByText('Toyota'));
    expect(onSelect).toHaveBeenCalledWith('toyota');
  });
});
