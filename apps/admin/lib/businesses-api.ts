import type {
  AccountStatus, AdminBusinessDetail, AdminBusinessList, BusinessActivity, CategoryNode, MemberRole, VerificationStatus,
} from '@mpm/shared-types';
import { api } from './api';

// Typed calls to the Users & businesses API (F1 + A2 spec §8.2). Each returns the endpoint's `data`.

export interface BusinessListQuery {
  /** Trade or legal name, city, industrial area (listed or typed as Other), the owner's phone, or a GSTIN prefix. */
  search?: string;
  city?: string;
  verification?: VerificationStatus;
  status?: AccountStatus;
  page?: number;
  pageSize?: number;
}

export function fetchBusinesses(query: BusinessListQuery = {}): Promise<AdminBusinessList> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return api.get<AdminBusinessList>(`/admin/businesses${qs ? `?${qs}` : ''}`);
}

export const fetchBusiness = (id: string) => api.get<AdminBusinessDetail>(`/admin/businesses/${id}`);

/** The machine categories' names by id (level-1 nodes of the public tree), for the profile's category ids. */
export async function fetchCategoryNames(): Promise<Map<string, string>> {
  const tree = await api.get<CategoryNode[]>('/categories');
  return new Map(tree.map((node) => [node.id, node.name]));
}

// Reasons: ADMIN_REASON_MIN–ADMIN_REASON_MAX (3–500) from shared-types, the API's one rule (`lib/admin-text.ts`).

/** 409 GST_NOT_VERIFIED when there is nothing to revoke. */
export const revokeGst = (id: string, reason: string) => api.post<unknown>(`/admin/businesses/${id}/gst/revoke`, { reason });

/** 409 GST_REVIEW_OPEN while a review is waiting or needs more; GST_ALREADY_VERIFIED; GSTIN_NOT_HELD. */
export const releaseGstin = (id: string, reason: string) => api.post<unknown>(`/admin/businesses/${id}/gst/release`, { reason });

export type UserStatusAction = 'suspend' | 'reinstate' | 'block' | 'unblock';

/** Suspend / reinstate: officers and moderators; block / unblock: super admins. */
export const changeUserStatus = (userId: string, action: UserStatusAction, reason: string) =>
  api.post<unknown>(`/admin/users/${userId}/${action}`, { reason });

// ─── wording ───

export const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  not_submitted: 'Not verified',
  pending: 'Under review',
  approved: 'Verified',
  rejected: 'Rejected',
};

/** The verification badge's colour: the stored summary means something else here than the shared status map. */
export const VERIFICATION_TONE = { not_submitted: 'gray', pending: 'amber', approved: 'green', rejected: 'red' } as const;

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  active: 'Active',
  suspended: 'Suspended',
  blocked: 'Blocked',
};

export const ACTIVITY_LABELS: Record<BusinessActivity, string> = {
  buy: 'Buys',
  sell: 'Sells',
  rent_out: 'Rents out machines',
};

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Owner',
  listing_manager: 'Listing manager',
  sales: 'Sales',
  viewer: 'Viewer',
};

/** Google Maps at the business's pin. */
export const mapsLink = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`;
