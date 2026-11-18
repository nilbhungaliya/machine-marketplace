import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { APP_SETTINGS, appSettingDefaults, type AppSettingsView } from '@mpm/shared-types';
import { ConfirmProvider } from '@/components/confirm-provider';

vi.mock('@/lib/settings-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/settings-api')>()),
  updateSettings: vi.fn(),
  fetchExpiryImpact: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from 'sonner';
import { fetchExpiryImpact, updateSettings } from '@/lib/settings-api';
import { MarketplaceSettingsForm } from './marketplace-settings-form';

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) { return this.parentElement; },
  });
});

beforeEach(() => {
  vi.mocked(fetchExpiryImpact).mockResolvedValue({ days: 30, count: 0 });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const view = (): AppSettingsView => ({ values: appSettingDefaults(), registry: APP_SETTINGS });

function renderForm(v = view()) {
  const onSaved = vi.fn();
  render(<ConfirmProvider><MarketplaceSettingsForm view={v} onSaved={onSaved} /></ConfirmProvider>);
  return { onSaved };
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

describe('MarketplaceSettingsForm', () => {
  it('renders every setting from the registry with its value, range and help', () => {
    renderForm();
    expect(field('Listing expiry (days)').value).toBe('60');
    expect(field('Expiry reminder (days)').value).toBe('7');
    expect(field('Review first listings').value).toBe('3');
    expect(field('Unverified listing cap').value).toBe('3');
    expect(screen.getByText(/7 to 365/)).not.toBeNull();
    expect(screen.getByText(/Must be less than the expiry/)).not.toBeNull();
  });

  it('blocks Save while the reminder is not shorter than the expiry', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.clear(field('Expiry reminder (days)'));
    await user.type(field('Expiry reminder (days)'), '30');
    await user.clear(field('Listing expiry (days)'));
    await user.type(field('Listing expiry (days)'), '30');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('The reminder must be shorter than the expiry')).not.toBeNull();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('lowering the expiry shows how many listings the next run would expire', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchExpiryImpact).mockResolvedValue({ days: 30, count: 214 });
    renderForm();
    await user.clear(field('Listing expiry (days)'));
    await user.type(field('Listing expiry (days)'), '30');
    expect(await screen.findByText('214 listings would expire within the hour')).not.toBeNull();
    expect(fetchExpiryImpact).toHaveBeenLastCalledWith(30);
  });

  it('raising the expiry asks nothing', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.clear(field('Listing expiry (days)'));
    await user.type(field('Listing expiry (days)'), '90');
    await new Promise((r) => setTimeout(r, 600));
    expect(fetchExpiryImpact).not.toHaveBeenCalled();
  });

  it('Save sends only what changed and confirms with a toast', async () => {
    const user = userEvent.setup();
    const saved = { values: { ...appSettingDefaults(), unverified_listing_cap: 5 }, registry: APP_SETTINGS };
    vi.mocked(updateSettings).mockResolvedValue(saved);
    const { onSaved } = renderForm();
    await user.clear(field('Unverified listing cap'));
    await user.type(field('Unverified listing cap'), '5');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ unverified_listing_cap: 5 }));
    expect(onSaved).toHaveBeenCalledWith(saved);
    expect(toast.success).toHaveBeenCalledWith('Settings saved');
  });
});
