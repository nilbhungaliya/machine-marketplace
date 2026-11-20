import { useQuery } from '@tanstack/react-query';
import { fetchPartRequest, fetchPartRequestOptions } from '@/lib/part-requests-api';
import { qk } from '@/lib/query-keys';

/** One request: the buyer's or the seller's view (F8 §12.2); 404 `PART_REQUEST_NOT_FOUND` when it's gone or not ours. */
export function usePartRequest(id: string) {
  return useQuery({ queryKey: qk.partRequest(id), queryFn: () => fetchPartRequest(id), retry: false });
}

/** Settings and, signed in, the open count / limit (Profile's row, the form's limits). Public. */
export function usePartRequestOptions() {
  return useQuery({ queryKey: qk.partRequestOptions(), queryFn: fetchPartRequestOptions, staleTime: 60_000 });
}
