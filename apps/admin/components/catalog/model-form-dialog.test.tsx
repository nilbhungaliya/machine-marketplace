import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SIDE_CONVENTION, type Brand, type CatalogLevel, type CategoryNode, type MachineModel } from '@mpm/shared-types';
import { ConfirmProvider } from '@/components/confirm-provider';

vi.mock('@/lib/catalog-api', () => ({ createModel: vi.fn(), updateModel: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { createModel, updateModel } from '@/lib/catalog-api';
import { ApiError } from '@/lib/api';
import { ModelFormDialog } from './model-form-dialog';

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

function node(id: string, name: string, level: CatalogLevel, children: CategoryNode[] = []): CategoryNode {
  return {
    id, parentId: null, level, name, slug: id, path: id, icon: null, sortOrder: 0, isActive: true,
    hasSides: null, sideConvention: null, effectiveHasSides: false, effectiveSideConvention: DEFAULT_SIDE_CONVENTION,
    children: children.map((c) => ({ ...c, parentId: id })),
  };
}

const tree: CategoryNode[] = [
  node('sewing', 'Sewing', 'machine_category', [
    node('multi', 'Multi Head Embroidery', 'machine_type', [node('hooks', 'Rotary Hooks', 'part_group')]),
  ]),
  node('weaving', 'Weaving', 'machine_category', [node('waterjet', 'Water Jet Loom', 'machine_type')]),
];

const tajima: Brand = {
  id: 'tajima', key: 'tajima', name: 'Tajima', slug: 'tajima', makesMachines: true, makesParts: true,
  needsReview: false, sortOrder: 0, isActive: true,
};

const tmar: MachineModel = {
  id: 'm1', key: 'tmar_kc', brandId: 'tajima', machineTypeId: 'multi', name: 'TMAR-KC', needsReview: false, sortOrder: 0, isActive: true,
};

describe('ModelFormDialog', () => {
  it('create: the machine type select lists only machine types', () => {
    render(
      <ConfirmProvider>
        <ModelFormDialog mode="create" brand={tajima} tree={tree} onClose={() => {}} onSaved={() => {}} />
      </ConfirmProvider>,
    );
    const options = within(screen.getByLabelText('Machine type')).getAllByRole('option').slice(1).map((o) => o.textContent);
    expect(options).toEqual(['Sewing › Multi Head Embroidery', 'Weaving › Water Jet Loom']);
  });

  it('create: sends the model and shows a 409 NAME_TAKEN under Name', async () => {
    const user = userEvent.setup();
    vi.mocked(createModel).mockRejectedValueOnce(new ApiError('taken', 409, 'NAME_TAKEN'));
    const onSaved = vi.fn();
    render(
      <ConfirmProvider>
        <ModelFormDialog mode="create" brand={tajima} tree={tree} onClose={() => {}} onSaved={onSaved} />
      </ConfirmProvider>,
    );
    await user.type(screen.getByLabelText('Name'), 'TMAR KC');
    expect((screen.getByLabelText('Key') as HTMLInputElement).value).toBe('tmar_kc');
    await user.selectOptions(screen.getByLabelText('Machine type'), 'multi');
    await user.click(screen.getByRole('button', { name: 'Add model' }));
    expect(createModel).toHaveBeenCalledWith({ brandId: 'tajima', machineTypeId: 'multi', key: 'tmar_kc', name: 'TMAR KC' });
    const error = await screen.findByText('Tajima already has a model with this name for this machine type');
    expect(error.id).toBe(screen.getByLabelText('Name').getAttribute('aria-describedby'));
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('create: a machine type is required', async () => {
    const user = userEvent.setup();
    render(
      <ConfirmProvider>
        <ModelFormDialog mode="create" brand={tajima} tree={tree} onClose={() => {}} onSaved={() => {}} />
      </ConfirmProvider>,
    );
    await user.type(screen.getByLabelText('Name'), 'TMAR');
    await user.click(screen.getByRole('button', { name: 'Add model' }));
    expect(await screen.findByText('Choose a machine type')).not.toBeNull();
    expect(createModel).not.toHaveBeenCalled();
  });

  it('edit: the key is read-only and only the name is sent', async () => {
    const user = userEvent.setup();
    vi.mocked(updateModel).mockResolvedValueOnce({ ...tmar, name: 'TMAR-KC II' });
    const onSaved = vi.fn();
    render(
      <ConfirmProvider>
        <ModelFormDialog mode="edit" brand={tajima} model={tmar} tree={tree} onClose={() => {}} onSaved={onSaved} />
      </ConfirmProvider>,
    );
    expect(screen.queryByLabelText('Key')).toBeNull();
    expect(screen.getByText('tmar_kc')).not.toBeNull();
    expect(screen.getByText('Sewing › Multi Head Embroidery')).not.toBeNull();
    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'TMAR-KC II');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(updateModel).toHaveBeenCalledWith('m1', { name: 'TMAR-KC II' });
    expect(onSaved).toHaveBeenCalled();
  });

  it('edit: a 409 NAME_TAKEN shows under Name', async () => {
    const user = userEvent.setup();
    vi.mocked(updateModel).mockRejectedValueOnce(new ApiError('taken', 409, 'NAME_TAKEN'));
    render(
      <ConfirmProvider>
        <ModelFormDialog mode="edit" brand={tajima} model={tmar} tree={tree} onClose={() => {}} onSaved={() => {}} />
      </ConfirmProvider>,
    );
    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'TMAR');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Tajima already has a model with this name for this machine type')).not.toBeNull();
  });
});
