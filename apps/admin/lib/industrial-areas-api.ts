import type { IndustrialArea } from '@mpm/shared-types';
import { api } from './api';

// Typed calls to the Industrial areas API (F1 spec §4.3, §8.3). Each returns the endpoint's `data`.

/** One "Other" text businesses typed, grouped by the pincode's district and state (`GET /admin/industrial-areas/other`). */
export interface OtherValue {
  /** Lower-cased and trimmed. */
  text: string;
  district: string;
  state: string;
  /** How many businesses typed it there. */
  count: number;
  /** False when the pincode directory doesn't know these businesses' pincode: Add to list can't link them. */
  adoptable: boolean;
}

/** Every area, inactive ones included, by state, city and sort order. */
export const fetchAreas = () => api.get<IndustrialArea[]>('/admin/industrial-areas');

/** Goes last in its city. 409 NAME_TAKEN when the city has an area with that name. */
export const createArea = (input: { name: string; city: string; state: string }) =>
  api.post<IndustrialArea>('/admin/industrial-areas', input);

export const updateArea = (id: string, patch: { name?: string; isActive?: boolean }) =>
  api.patch<IndustrialArea>(`/admin/industrial-areas/${id}`, patch);

/** 409 AREA_IN_USE while a business uses it. */
export const deleteArea = (id: string) => api.delete<null>(`/admin/industrial-areas/${id}`);

/** `ids` must be every area of the city, inactive ones included (409 STALE_ORDER otherwise). */
export const reorderAreas = (input: { city: string; state: string; ids: string[] }) =>
  api.post<null>('/admin/industrial-areas/reorder', input);

export const fetchOtherValues = () => api.get<OtherValue[]>('/admin/industrial-areas/other');

/** Creates the area for the district and links every business that typed `text` there. */
export const adoptOtherValue = (input: { text: string; district: string; state: string; name: string }) =>
  api.post<{ areaId: string; linked: number }>('/admin/industrial-areas/other/adopt', input);

/** "sachin gidc" → "Sachin Gidc": the starting name for Add to list (the admin edits it). */
export function titleCase(text: string): string {
  return text.trim().toLowerCase().replace(/(^|[\s\-/(])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** A city's key in the picker: city and state, which together name the list an area belongs to. */
export const cityKey = (city: string, state: string) => `${city}|${state}`;
