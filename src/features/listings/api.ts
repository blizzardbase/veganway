// React Query hooks for the listings API. Other slices may import these (Me uses useBookmarks,
// the services profile uses the opinion and recommendation hooks, Home may use useDeals).
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type {
  CreateListingBody, CreateRecommendationBody, DealItem, ListingCard, ListingDetail, ListingKind, ListingSort, ListingSuggestion,
  OpinionCounts, OpinionValue, Page, Recommendation, VeganStatus,
} from '../../../shared/types/listings';

export interface ListingFilters {
  kind: ListingKind;
  area?: string;
  veganStatus?: VeganStatus;
  category?: string;
  store?: string;
  hasOffer?: boolean;
  sort: ListingSort;
}

export const listingKeys = {
  all: ['listings'] as const,
  list: (f: ListingFilters) => ['listings', 'list', f] as const,
  detail: (slug: string) => ['listings', 'detail', slug] as const,
  recs: (slug: string) => ['listings', 'recs', slug] as const,
  bookmarks: ['listings', 'bookmarks'] as const,
  deals: ['listings', 'deals'] as const,
  suggest: (q: string, kind?: ListingKind) => ['listings', 'suggest', q, kind ?? 'any'] as const,
};

function listUrl(f: ListingFilters, cursor: string | null): string {
  const p = new URLSearchParams({ kind: f.kind, sort: f.sort });
  if (f.area) p.set('area', f.area);
  if (f.veganStatus) p.set('vegan_status', f.veganStatus);
  if (f.category) p.set('category', f.category);
  if (f.store) p.set('store', f.store);
  if (f.hasOffer) p.set('has_offer', '1');
  if (cursor) p.set('cursor', cursor);
  return `/api/listings?${p}`;
}

/** Pages joined, with any item repeated across pages (a new listing shifted the offset) dropped. */
export function flatUnique<T extends { id: string }>(pages: Page<T>[] | undefined): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const page of pages ?? []) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

export function useListings(f: ListingFilters) {
  return useInfiniteQuery({
    queryKey: listingKeys.list(f),
    queryFn: ({ pageParam }) => api.get<Page<ListingCard>>(listUrl(f, pageParam)),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useListing(slug: string | undefined) {
  return useQuery({
    queryKey: listingKeys.detail(slug ?? ''),
    queryFn: async () => (await api.get<{ listing: ListingDetail }>(`/api/listings/${encodeURIComponent(slug ?? '')}`)).listing,
    enabled: Boolean(slug),
  });
}

export function useRecommendations(slug: string | undefined) {
  return useInfiniteQuery({
    queryKey: listingKeys.recs(slug ?? ''),
    queryFn: ({ pageParam }) =>
      api.get<Page<Recommendation>>(`/api/listings/${encodeURIComponent(slug ?? '')}/recommendations${pageParam ? `?cursor=${pageParam}` : ''}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: Boolean(slug),
  });
}

export function useBookmarks() {
  return useInfiniteQuery({
    queryKey: listingKeys.bookmarks,
    queryFn: ({ pageParam }) => api.get<Page<ListingCard>>(`/api/bookmarks${pageParam ? `?cursor=${pageParam}` : ''}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useDeals() {
  return useQuery({
    queryKey: listingKeys.deals,
    queryFn: async () => (await api.get<{ items: DealItem[] }>('/api/listings/offers/active')).items,
  });
}

export function useSuggest(q: string, kind?: ListingKind) {
  const text = q.trim();
  return useQuery({
    queryKey: listingKeys.suggest(text.toLowerCase(), kind),
    queryFn: async () => {
      const p = new URLSearchParams({ q: text });
      if (kind) p.set('kind', kind);
      return (await api.get<{ items: ListingSuggestion[] }>(`/api/listings/suggest?${p}`)).items;
    },
    enabled: text.length >= 2,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

function patchDetail(qc: QueryClient, slug: string, patch: Partial<ListingDetail>) {
  qc.setQueryData<ListingDetail>(listingKeys.detail(slug), (old) => (old ? { ...old, ...patch } : old));
}

/** Counts after moving one member's opinion from prev to next. */
export function shiftCounts(c: { recommendCount: number; notForMeCount: number }, prev: OpinionValue | null, next: OpinionValue | null) {
  let { recommendCount, notForMeCount } = c;
  if (prev === 'recommend') recommendCount--;
  if (prev === 'not_for_me') notForMeCount--;
  if (next === 'recommend') recommendCount++;
  if (next === 'not_for_me') notForMeCount++;
  return { recommendCount: Math.max(0, recommendCount), notForMeCount: Math.max(0, notForMeCount) };
}

/** Set (or clear with null) the member's opinion, optimistically. */
export function useSetOpinion(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (value: OpinionValue | null) =>
      value
        ? api.put<OpinionCounts>(`/api/listings/${encodeURIComponent(slug)}/opinion`, { value })
        : api.delete<OpinionCounts>(`/api/listings/${encodeURIComponent(slug)}/opinion`),
    onMutate: async (value) => {
      await qc.cancelQueries({ queryKey: listingKeys.detail(slug) });
      const before = qc.getQueryData<ListingDetail>(listingKeys.detail(slug));
      if (before) patchDetail(qc, slug, { ...shiftCounts(before, before.myOpinion, value), myOpinion: value });
      return { before };
    },
    onError: (_err, _value, ctx) => {
      if (ctx?.before) qc.setQueryData(listingKeys.detail(slug), ctx.before);
    },
    onSuccess: (counts) => patchDetail(qc, slug, counts),
    onSettled: () => qc.invalidateQueries({ queryKey: ['listings', 'list'] }),
  });
}

export function useSetSaved(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (saved: boolean) =>
      saved
        ? api.put<{ saved: boolean }>(`/api/listings/${encodeURIComponent(slug)}/bookmark`)
        : api.delete<{ saved: boolean }>(`/api/listings/${encodeURIComponent(slug)}/bookmark`),
    onMutate: async (saved) => {
      const before = qc.getQueryData<ListingDetail>(listingKeys.detail(slug));
      patchDetail(qc, slug, { saved });
      return { before };
    },
    onError: (_err, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(listingKeys.detail(slug), ctx.before);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: listingKeys.bookmarks }),
  });
}

export function useToggleUpvote(slug: string) {
  const qc = useQueryClient();
  type Pages = { pages: Page<Recommendation>[]; pageParams: unknown[] };
  const patch = (id: string, fn: (r: Recommendation) => Recommendation) =>
    qc.setQueryData<Pages>(listingKeys.recs(slug), (old) =>
      old ? { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.map((r) => (r.id === id ? fn(r) : r)) })) } : old);
  return useMutation({
    mutationFn: ({ id, upvote }: { id: string; upvote: boolean }) =>
      upvote
        ? api.put<{ upvoted: boolean; upvotes: number }>(`/api/recommendations/${id}/upvote`)
        : api.delete<{ upvoted: boolean; upvotes: number }>(`/api/recommendations/${id}/upvote`),
    onMutate: ({ id, upvote }) => {
      patch(id, (r) => ({ ...r, upvotedByMe: upvote, upvotes: Math.max(0, r.upvotes + (upvote ? 1 : -1)) }));
    },
    onError: (_err, { id, upvote }) => {
      patch(id, (r) => ({ ...r, upvotedByMe: !upvote, upvotes: Math.max(0, r.upvotes + (upvote ? -1 : 1)) }));
    },
    onSuccess: (res, { id }) => patch(id, (r) => ({ ...r, upvotedByMe: res.upvoted, upvotes: res.upvotes })),
  });
}

export function useCreateRecommendation(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRecommendationBody) =>
      api.post<{ recommendation: Recommendation }>(`/api/listings/${encodeURIComponent(slug)}/recommendations`, body),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: listingKeys.recs(slug) }),
        qc.invalidateQueries({ queryKey: listingKeys.detail(slug) }),
        qc.invalidateQueries({ queryKey: listingKeys.deals }),
      ]);
    },
  });
}

export function useCreateListing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateListingBody) => api.post<{ listing: ListingDetail }>('/api/listings', body),
    onSuccess: async ({ listing }) => {
      qc.setQueryData(listingKeys.detail(listing.slug), listing);
      await qc.invalidateQueries({ queryKey: ['listings', 'list'] });
    },
  });
}

/** Reports belong to the services, me and admin slice (POST /api/reports). */
export type ReportReason = 'spam' | 'wrong_info' | 'offensive' | 'personal_info' | 'other';

export type ReportDestination =
  | { target_type: 'listing' | 'recommendation' | 'photo'; target_id: string }
  | { target_type: 'photo'; photo_url: string };

export function useReport() {
  return useMutation({
    mutationFn: async (body: ReportDestination & { reason: ReportReason }) => {
      if ('photo_url' in body) {
        const photo = await api.get<{ id: string }>(`/api/reports/photo-target?url=${encodeURIComponent(body.photo_url)}`);
        return api.post<unknown>('/api/reports', { target_type: 'photo', target_id: photo.id, reason: body.reason });
      }
      return api.post<unknown>('/api/reports', body);
    },
  });
}
