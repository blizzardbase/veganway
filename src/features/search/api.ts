// Search results, and recent searches kept only in this browser.
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { SearchGroup, SearchResults, SearchType } from '../../../shared/types/search';

function mergeGroup<T extends { id: string }>(groups: SearchGroup<T>[]): SearchGroup<T> {
  const seen = new Set<string>();
  return {
    total: groups[0]?.total ?? 0,
    items: groups.flatMap((g) => g.items).filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }),
  };
}

export function useSearch(q: string, type: SearchType | null) {
  const trimmed = q.trim();
  return useInfiniteQuery({
    queryKey: ['search', trimmed, type],
    queryFn: ({ pageParam }) => api.get<SearchResults>(`/api/search?q=${encodeURIComponent(trimmed)}${type ? `&type=${type}&offset=${pageParam}` : ''}`),
    initialPageParam: 0,
    placeholderData: keepPreviousData,
    getNextPageParam: (last, _pages, offset) => {
      if (!type || offset >= 1000) return undefined;
      const group = last[type];
      const next = offset + group.items.length;
      return group.items.length > 0 && next < group.total ? Math.min(next, 1000) : undefined;
    },
    select: ({ pages }): SearchResults => ({
      q: pages[0].q,
      places: mergeGroup(pages.map((p) => p.places)),
      products: mergeGroup(pages.map((p) => p.products)),
      services: mergeGroup(pages.map((p) => p.services)),
      discussions: mergeGroup(pages.map((p) => p.discussions)),
    }),
    enabled: trimmed.length > 0,
    retry: false,
    staleTime: 30_000,
  });
}

const KEY = 'vw-recent-searches';
const MAX = 8;

export function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string').slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function rememberSearch(q: string): string[] {
  const t = q.trim();
  if (!t) return readRecent();
  const next = [t, ...readRecent().filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: recent searches last for this visit only.
  }
  return next;
}

export function clearRecent(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored.
  }
}
