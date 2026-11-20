import { useQuery } from '@tanstack/react-query';
import { useMember } from '@/hooks/use-badges';
import { fetchPartRequestHome } from '@/lib/part-requests-api';
import { qk } from '@/lib/query-keys';

/** Home's buyer and seller strips (F8 §13.4); members only (the route needs a business). */
export function usePartRequestHome() {
  const member = useMember();
  return useQuery({ queryKey: qk.partRequestHome(), queryFn: fetchPartRequestHome, enabled: member, staleTime: 30_000 });
}
