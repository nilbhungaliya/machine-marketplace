'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminReportRow, ReportStatus } from '@mpm/shared-types';
import { api } from '@/lib/api';
import type { AdminReportPage } from '@/lib/conversations-api';
import { getAdminSocket } from '@/lib/socket';

/** The targets of Reports & flags: conversations, reviews and (F8 §14) part requests. */
export type ReportsTarget = AdminReportRow['target'];

/**
 * `GET /admin/reports?target=&status=&cursor=` for any of the three targets (`conversations-api`'s
 * `fetchAdminReports` is typed for the F6 two; the API takes all three since F8).
 */
function fetchReports(q: { target: ReportsTarget; status?: ReportStatus; cursor?: string }): Promise<AdminReportPage> {
  const params = new URLSearchParams({ target: q.target });
  if (q.status) params.set('status', q.status);
  if (q.cursor) params.set('cursor', q.cursor);
  return api.get<AdminReportPage>(`/admin/reports?${params.toString()}`);
}

/**
 * One target's reports (`GET /admin/reports`), newest first, 30 a page by cursor: the first page on mount and on a
 * filter change, more on `loadMore`, all again on `reload` or a `report:new` socket event for this target (ids only).
 */
export function useAdminReports(target: ReportsTarget, status: ReportStatus | undefined) {
  const [items, setItems] = useState<AdminReportRow[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const page = await fetchReports({ target, status });
      if (ticket !== latest.current) return;
      setItems(page.items);
      setCursor(page.nextCursor);
      setError(null);
    } catch (err) {
      if (ticket === latest.current) setError(err instanceof Error ? err.message : 'Could not load the reports');
    }
  }, [target, status]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    const ticket = latest.current;
    setLoadingMore(true);
    try {
      const page = await fetchReports({ target, status, cursor });
      if (ticket !== latest.current) return;
      setItems((prev) => [...(prev ?? []), ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      if (ticket === latest.current) setError(err instanceof Error ? err.message : 'Could not load more reports');
    } finally {
      setLoadingMore(false);
    }
  }, [target, status, cursor]);

  useEffect(() => {
    setItems(null);
    void reload();
  }, [reload]);

  const reloadRef = useRef(reload);
  useEffect(() => { reloadRef.current = reload; }, [reload]);
  useEffect(() => {
    const socket = getAdminSocket();
    const onNew = (payload: { target?: string } = {}) => {
      if (!payload?.target || payload.target === target) void reloadRef.current();
    };
    socket.on('report:new', onNew);
    return () => { socket.off('report:new', onNew); };
  }, [target]);

  return { items, error, hasMore: cursor !== null, loadingMore, loadMore, reload };
}
