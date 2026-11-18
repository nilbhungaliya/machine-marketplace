import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Brand, BrandWithModels } from '@mpm/shared-types';
import { ConfirmProvider } from '@/components/confirm-provider';

vi.mock('next/navigation', () => ({ usePathname: () => '/brands-models' }));
vi.mock('@/lib/catalog-api', () => ({
  fetchAdminBrands: vi.fn(),
  fetchAdminTree: vi.fn().mockResolvedValue([]),
  createBrand: vi.fn(),
  updateBrand: vi.fn(),
  reorderBrands: vi.fn(),
  deleteBrand: vi.fn(),
  deleteModel: vi.fn(),
  moveModel: vi.fn(),
  reorderModels: vi.fn(),
  updateModel: vi.fn(),
  downloadExport: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { createBrand, fetchAdminBrands } from '@/lib/catalog-api';
import BrandsModelsPage from './page';

beforeAll(() => {
  // Wide screen: the page skips scrolling the models panel into view.
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }),
  });
});

beforeEach(() => window.history.replaceState(null, '', '/brands-models'));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.style.overflow = '';
});

const brandRow = (id: string, name: string): BrandWithModels => ({
  id, key: id, name, slug: id, makesMachines: true, makesParts: false, needsReview: false, sortOrder: 0, isActive: true, models: [],
});

describe('BrandsModelsPage', () => {
  it('after "Add brand", the new brand is selected and its models panel shown', async () => {
    const user = userEvent.setup();
    const tajima = brandRow('tajima', 'Tajima');
    const created = brandRow('barudan', 'Barudan');
    // First load: Tajima only; the reload after the create also returns the new brand.
    vi.mocked(fetchAdminBrands).mockResolvedValueOnce([tajima]).mockResolvedValue([tajima, created]);
    const { models: _models, ...createdBrand } = created;
    vi.mocked(createBrand).mockResolvedValue(createdBrand as Brand);

    render(<ConfirmProvider><BrandsModelsPage /></ConfirmProvider>);
    await screen.findByText('Tajima');
    expect(screen.getByText('Pick a brand')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Add brand' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Barudan');
    await user.click(within(dialog).getByRole('button', { name: 'Add brand' }));

    await waitFor(() => expect(createBrand).toHaveBeenCalledWith(expect.objectContaining({ key: 'barudan', name: 'Barudan' })));
    // The reload shows the new brand in the table…
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Brands' })).getByText('Barudan')).not.toBeNull());
    // …and it stays selected (selecting before the reload lost it: the page cleared the unknown id).
    const panel = screen.getByRole('region', { name: 'Models of the selected brand' });
    await waitFor(() => expect(within(panel).getByRole('heading', { name: 'Barudan' })).not.toBeNull());
    expect(window.location.search).toBe('?brand=barudan');
    expect(screen.queryByText('Pick a brand')).toBeNull();
  });
});
