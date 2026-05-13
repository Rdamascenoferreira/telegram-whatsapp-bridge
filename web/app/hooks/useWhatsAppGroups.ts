'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { requestJson } from '../../lib/http';

export type GroupsPageMeta = {
  refreshing: boolean;
  progress: {
    phase?: string;
    total: number;
    processed?: number;
    percent?: number;
    foundAdmins?: number;
  } | null;
  cachedAt: string;
  cacheStale: boolean;
  selectedGroupIds: string[];
  adminGroupCount: number;
  totalAvailable: number;
};

export type GroupItem = {
  id: string;
  name: string;
  kind?: 'group' | 'announcement' | 'community_group';
  isAnnouncement?: boolean;
  isCommunityLinked?: boolean;
  parentGroupId?: string | null;
  hasAdminAccess?: boolean | null;
  selected?: boolean;
};

export type GroupsPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type GroupsPageResponse = {
  groups: GroupItem[];
  pagination: GroupsPagination;
  meta: GroupsPageMeta;
};

/**
 * Hook that fetches WhatsApp groups from the lightweight paginated API.
 * - Debounces search input to avoid flooding the server.
 * - Auto-polls when a refresh is in progress.
 * - Returns cached data instantly while fresh data loads.
 */
export function useWhatsAppGroups({
  search,
  page,
  pageSize = 50,
  filter = 'all',
  enabled = true
}: {
  search: string;
  page: number;
  pageSize?: number;
  filter?: string;
  enabled?: boolean;
}) {
  const [data, setData] = useState<GroupsPageResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fetchIdRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchGroups = useCallback(
    async (searchValue: string, pageValue: number) => {
      const fetchId = ++fetchIdRef.current;
      setLoading(true);
      setError('');

      try {
        const params = new URLSearchParams({
          search: searchValue,
          page: String(pageValue),
          pageSize: String(pageSize),
          filter
        });
        const result = await requestJson<GroupsPageResponse>(
          `/api/groups/list?${params.toString()}`,
          { timeoutMs: 10_000 }
        );

        // Only apply if this is still the latest request
        if (fetchId === fetchIdRef.current) {
          setData(result);
        }
      } catch (err) {
        if (fetchId === fetchIdRef.current) {
          setError(err instanceof Error ? err.message : 'Falha ao carregar grupos.');
        }
      } finally {
        if (fetchId === fetchIdRef.current) {
          setLoading(false);
        }
      }
    },
    [pageSize, filter]
  );

  // Debounced fetch on search/page changes
  useEffect(() => {
    if (!enabled) return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      void fetchGroups(search, page);
    }, search ? 300 : 0); // debounce search, instant for page changes

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [search, page, filter, enabled, fetchGroups]);

  // Auto-poll while refreshing
  useEffect(() => {
    if (!enabled || !data?.meta?.refreshing) return;

    const interval = setInterval(() => {
      void fetchGroups(search, page);
    }, 2000);

    return () => clearInterval(interval);
  }, [enabled, data?.meta?.refreshing, search, page, fetchGroups]);

  const reload = useCallback(() => {
    void fetchGroups(search, page);
  }, [fetchGroups, search, page]);

  return { data, loading, error, reload };
}
