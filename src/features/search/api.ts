// Search results, and recent searches kept only in this browser.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { SearchResults, SearchType } from '../../../shared/types/search';

export function useSearch(q: string, type: SearchType | null) {
  const trimmed = q.trim();
  return useQuery({
    queryKey: ['search', trimmed, type],
    queryFn: () => api.get<SearchResults>(`/api/search?q=${encodeURIComponent(trimmed)}${type ? `&type=${type}` : ''}`),
    enabled: trimmed.length > 0,
    placeholderData: keepPreviousData,
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
