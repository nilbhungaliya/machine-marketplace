import { useQuery } from '@tanstack/react-query';
import {
  fetchIndustrialAreas,
  fetchMachineCategories,
  fetchMyBusiness,
  fetchPincode,
} from '@/lib/business-api';
import { fetchGstState } from '@/lib/gst-api';

// Server state for the business profile and location (React Query). Keys are not user-scoped: useAuth clears the
// cache on sign-in and sign-out.

export const businessKeys = {
  me: ['business', 'me'] as const,
  machineCategories: ['catalog', 'machine-categories'] as const,
  pincode: (pincode: string) => ['locations', 'pincode', pincode] as const,
  areas: (pincode: string) => ['locations', 'industrial-areas', pincode] as const,
  gst: ['business', 'me', 'gst'] as const,
};

/** GET /businesses/me/gst, for `fetchQuery` outside a component (Profile rows, the GST intro). */
export const gstStateQuery = { queryKey: businessKeys.gst, queryFn: fetchGstState, staleTime: 0 };

/**
 * The business's GST state (spec §5.5). Always refetched on mount: an officer's decision has no push yet, so the
 * business sees it when it next opens Profile or a GST screen. Pass `enabled: false` before the business exists.
 */
export function useGstState(enabled = true) {
  return useQuery({ ...gstStateQuery, enabled, refetchOnMount: 'always' });
}

/** The signed-in user's business; `data` is `null` before onboarding has created it. Pass `enabled: false` for a guest. */
export function useBusiness(enabled = true) {
  return useQuery({ queryKey: businessKeys.me, queryFn: () => fetchMyBusiness(), enabled });
}

export function useMachineCategories() {
  return useQuery({ queryKey: businessKeys.machineCategories, queryFn: fetchMachineCategories, staleTime: 30 * 60 * 1000 });
}

/** City and state for a valid pincode (`null` when the directory doesn't have it). Pass `null` to wait. */
export function usePincodeInfo(pincode: string | null) {
  return useQuery({
    queryKey: businessKeys.pincode(pincode ?? ''),
    queryFn: () => fetchPincode(pincode!),
    enabled: pincode !== null,
    staleTime: Infinity,
  });
}

/** The industrial-area picker's list for a valid pincode. Pass `null` to wait. */
export function useIndustrialAreas(pincode: string | null) {
  return useQuery({
    queryKey: businessKeys.areas(pincode ?? ''),
    queryFn: () => fetchIndustrialAreas(pincode!),
    enabled: pincode !== null,
  });
}
