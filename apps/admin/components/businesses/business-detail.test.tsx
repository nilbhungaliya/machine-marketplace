import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AccountStatus, AdminBusinessDetail, AdminRole } from '@mpm/shared-types';
import { ConfirmProvider } from '@/components/confirm-provider';

const auth = vi.hoisted(() => ({ role: 'support' as AdminRole }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    user: { id: 'a1', name: 'Admin', email: 'a@x.in', role: auth.role },
    isSuperAdmin: auth.role === 'super_admin',
    hasRole: (...roles: AdminRole[]) => auth.role === 'super_admin' || roles.includes(auth.role),
  }),
}));
vi.mock('@/lib/businesses-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/businesses-api')>()),
  changeUserStatus: vi.fn().mockResolvedValue({}),
  revokeGst: vi.fn().mockResolvedValue({}),
  releaseGstin: vi.fn().mockResolvedValue({}),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { changeUserStatus } from '@/lib/businesses-api';
import { BusinessDetail } from './business-detail';

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

function business({ userStatus = 'active', verified = true, reviewOpen = false, gstin = '24AAKFS4821M1Z6' }: {
  userStatus?: AccountStatus; verified?: boolean; reviewOpen?: boolean; gstin?: string | null;
} = {}): AdminBusinessDetail {
  return {
    profile: {
      id: 'b1',
      userName: 'Hitesh Patel',
      tradeName: 'Shree Ambica Engineering',
      legalName: verified ? 'SHREE AMBICA ENGINEERING' : null,
      displayName: 'Shree Ambica Engineering',
      nameLocked: verified,
      activities: ['buy', 'sell'],
      categories: ['cat-tex', 'cat-gone'],
      email: null,
      yearEstablished: 2011,
      employees: '11-50',
      location: {
        pincode: '395023', city: 'Surat', state: 'Gujarat', industrialAreaId: 'ia1', industrialAreaName: 'Sachin GIDC',
        industrialAreaOther: null, addressLine: 'Plot 12', lat: 21.08, lng: 72.88,
      },
      gstin,
      constitution: verified ? 'Partnership' : null,
      gstRegisteredOn: null,
      gstAddress: null,
      verificationLevels: verified ? ['phone', 'gst'] : ['phone'],
      verificationStatus: verified ? 'approved' : reviewOpen ? 'pending' : 'rejected',
      verifiedAt: verified ? '2026-11-18T05:00:00.000Z' : null,
      onboarding: 'done',
      completion: { name: true, activities: true, location: true, gst: verified },
    },
    verificationNote: null,
    users: [{ id: 'u1', name: 'Ramesh Patel', phone: '+919825041736', status: userStatus, memberRole: 'owner', createdAt: '2026-11-01T05:00:00.000Z' }],
    gst: verified
      ? { mode: 'stub', state: 'verified', instantAllowed: true, storageAvailable: false, gstin: gstin ?? undefined }
      : { mode: 'stub', state: reviewOpen ? 'under_review' : 'revoked', instantAllowed: false, storageAvailable: false, gstin: gstin ?? undefined },
    reviewOpen,
    history: { checks: [], proofs: [], verifications: [] },
    audit: [],
    listingsCount: 0,
  };
}

function renderDetail(role: AdminRole, b: AdminBusinessDetail) {
  auth.role = role;
  const onChanged = vi.fn();
  render(
    <ConfirmProvider>
      <BusinessDetail business={b} categoryNames={new Map([['cat-tex', 'Textile machinery']])} onChanged={onChanged} />
    </ConfirmProvider>,
  );
  return { onChanged };
}

const usersTable = () => screen.getByRole('table', { name: 'Users' });

describe('BusinessDetail', () => {
  it('a moderator sees Suspend but not Block or Revoke GST', () => {
    renderDetail('moderator', business());
    expect(within(usersTable()).getByRole('button', { name: 'Suspend' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Block' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Revoke GST' })).toBeNull();
  });

  it('a verification officer sees Revoke GST on a verified business, and no Block', () => {
    renderDetail('verification_officer', business());
    expect(screen.getByRole('button', { name: 'Revoke GST' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Block' })).toBeNull();
  });

  it('support sees no actions', () => {
    renderDetail('support', business());
    expect(screen.queryByRole('button', { name: 'Suspend' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Revoke GST' })).toBeNull();
  });

  it('a super admin sees Unblock on a blocked user and not Reinstate', () => {
    renderDetail('super_admin', business({ userStatus: 'blocked' }));
    const table = usersTable();
    expect(within(table).getByRole('button', { name: 'Unblock' })).not.toBeNull();
    expect(within(table).queryByRole('button', { name: 'Reinstate' })).toBeNull();
    expect(within(table).queryByRole('button', { name: 'Suspend' })).toBeNull();
    expect(within(table).getByText('Blocked')).not.toBeNull();
  });

  it('Release GSTIN is disabled with a hint while a review is open', () => {
    renderDetail('verification_officer', business({ verified: false, reviewOpen: true }));
    const release = screen.getByRole('button', { name: 'Release GSTIN' }) as HTMLButtonElement;
    expect(release.disabled).toBe(true);
    expect(screen.getByText('Decide the open GST review first.')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Revoke GST' })).toBeNull();
  });

  it('Release GSTIN is enabled on a revoked business with no open review', () => {
    renderDetail('verification_officer', business({ verified: false }));
    expect((screen.getByRole('button', { name: 'Release GSTIN' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('Suspend asks for a reason and sends it', async () => {
    const user = userEvent.setup();
    const { onChanged } = renderDetail('moderator', business());
    await user.click(within(usersTable()).getByRole('button', { name: 'Suspend' }));
    const dialog = screen.getByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Suspend' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    // Destructive: the red danger button, not the primary one.
    expect(submit.className).toContain('text-red-600');
    await user.type(within(dialog).getByLabelText('Reason'), 'Fake listings reported');
    await user.click(submit);
    expect(changeUserStatus).toHaveBeenCalledWith('u1', 'suspend', 'Fake listings reported');
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('shows the machine categories by name and links the pin to Google Maps', () => {
    renderDetail('support', business());
    expect(screen.getByText('Textile machinery')).not.toBeNull();
    expect(screen.getByRole('link', { name: /Open in Google Maps/ }).getAttribute('href'))
      .toBe('https://www.google.com/maps?q=21.08,72.88');
  });

  it('links "Listings (n)" to the all-listings page filtered to this business (F2 spec §11.4)', () => {
    renderDetail('support', { ...business(), listingsCount: 2 });
    const link = screen.getByRole('link', { name: 'Listings (2)' });
    expect(link.getAttribute('href')).toMatch(/^\/listings\/?\?businessId=b1$/);
  });
});
