'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminReportRow, ReportStatus } from '@mpm/shared-types';
import { fetchAdminReports, type AdminReportTarget } from '@/lib/conversations-api';
import { getAdminSocket } from '@/lib/socket';

/**
 * One target's reports (`GET /admin/reports`), newest first, 30 a page by cursor: the first page on mount and on a
 * filter change, more on `loadMore`, all again on `reload` or a `report:new` socket event for this target (ids only).
 */
export function useAdminReports(target: AdminReportTarget, status: ReportStatus | undefined) {
  const [items, setItems] = useState<AdminReportRow[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const page = await fetchAdminReports({ target, status });
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
      const page = await fetchAdminReports({ target, status, cursor });
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
