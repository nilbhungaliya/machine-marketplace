import type { ApiSuccess, BusinessProfile, CategoryNode, IndustrialArea, PincodeInfo } from '@mpm/shared-types';
import api from './api';
import { errorCode, errorStatus } from './api-error';
import type { LocationBody, ProfileBody } from './onboarding-step';

// The business profile and location (F1 spec §10): `apps/api/src/routes/{businesses,locations,catalog}.ts`.

/** GET /businesses/me; `null` before the first PATCH has created the business (404 NO_BUSINESS). */
export async function fetchMyBusiness(opts: { timeout?: number } = {}): Promise<BusinessProfile | null> {
  try {
    const { data } = await api.get<ApiSuccess<BusinessProfile>>('/businesses/me', opts);
    return data.data;
  } catch (err) {
    if (errorCode(err) === 'NO_BUSINESS') return null;
    throw err;
  }
}

/** PATCH /businesses/me: creates the business on the first call (name, business name and activities needed). */
export async function updateProfile(body: ProfileBody): Promise<BusinessProfile> {
  const { data } = await api.patch<ApiSuccess<BusinessProfile>>('/businesses/me', body);
  return data.data;
}

/** PUT /businesses/me/location: replaces the whole location (`400 AREA_MISMATCH` for an area of another district). */
export async function saveLocation(body: LocationBody): Promise<BusinessProfile> {
  const { data } = await api.put<ApiSuccess<BusinessProfile>>('/businesses/me/location', body);
  return data.data;
}

/** The active machine categories (level-1 catalogue nodes) from GET /categories, without their subtrees. */
export async function fetchMachineCategories(): Promise<CategoryNode[]> {
  const { data } = await api.get<ApiSuccess<CategoryNode[]>>('/categories');
  return data.data.filter((n) => n.level === 'machine_category').map((n) => ({ ...n, children: [] }));
}

const nullOn404 = async <T>(call: () => Promise<T>): Promise<T | null> => {
  try {
    return await call();
  } catch (err) {
    if (errorStatus(err) === 404) return null;
    throw err;
  }
};

/** GET /locations/pincodes/:pincode; `null` for a pincode the directory doesn't have. */
export function fetchPincode(pincode: string): Promise<PincodeInfo | null> {
  return nullOn404(async () => (await api.get<ApiSuccess<PincodeInfo>>(`/locations/pincodes/${pincode}`)).data.data);
}

/** GET /locations/nearest-pincode: the nearest post office within 50 km; `null` beyond. */
export function fetchNearestPincode(lat: number, lng: number): Promise<PincodeInfo | null> {
  return nullOn404(async () => (await api.get<ApiSuccess<PincodeInfo>>('/locations/nearest-pincode', { params: { lat, lng } })).data.data);
}

/** GET /locations/industrial-areas?pincode=: the active areas of the pincode's district and state (`[]` if unknown). */
export async function fetchIndustrialAreas(pincode: string): Promise<IndustrialArea[]> {
  const { data } = await api.get<ApiSuccess<IndustrialArea[]>>('/locations/industrial-areas', { params: { pincode } });
  return data.data;
}
