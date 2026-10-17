// React Query hooks for the Home feed (server/routes/feed.ts). Votes and upvotes go to the Talk and
// Listings endpoints; these hooks also patch the feed cache so a card updates where it is.
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { patchTopic } from '../talk/api';
import type { FeedItem, FeedPage, PinnedResponse } from '../../../shared/types/feed';
import type { Poll, TopicSummary, UpvoteResponse, VoteResponse } from '../../../shared/types/talk';

export const feedKeys = {
  all: ['feed'] as const,
  stream: ['feed', 'stream'] as const,
  head: ['feed', 'head'] as const,
  pinned: ['feed', 'pinned'] as const,
};

/** The feed, 20 at a time. Always fresh on mount; window focus only checks the head (see useFeedHead). */
export function useFeed() {
  return useInfiniteQuery({
    queryKey: feedKeys.stream,
    queryFn: ({ pageParam }) => api.get<FeedPage>(`/api/feed${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}

/** The newest item only. Refetched when the window regains focus, to offer a "New posts" pill. */
export function useFeedHead() {
  return useQuery({
    queryKey: feedKeys.head,
    queryFn: async () => (await api.get<FeedPage>('/api/feed?limit=1')).items[0] ?? null,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function usePinned() {
  return useQuery({
    queryKey: feedKeys.pinned,
    queryFn: async () => (await api.get<PinnedResponse>('/api/feed/pinned')).items,
    staleTime: 0,
  });
}

/** Pages joined, keeping the first copy of any item a refetch shifted onto a later page. */
export function feedItems(data: InfiniteData<FeedPage> | undefined): FeedItem[] {
  const seen = new Set<string>();
  const out: FeedItem[] = [];
  for (const page of data?.pages ?? []) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

function patchFeed(qc: QueryClient, fn: (item: FeedItem) => FeedItem): void {
  qc.setQueryData<InfiniteData<FeedPage>>(feedKeys.stream, (data) => data && {
    ...data,
    pages: data.pages.map((p) => ({ ...p, items: p.items.map(fn) })),
  });
}

/** Change one topic in the feed, the pinned list and every Talk cache that holds it. */
function patchFeedTopic(qc: QueryClient, id: string, fn: (t: TopicSummary) => TopicSummary): void {
  patchFeed(qc, (item) => (item.type === 'topic' && item.topic.id === id ? { ...item, topic: fn(item.topic) } : item));
  qc.setQueryData<TopicSummary[]>(feedKeys.pinned, (list) => list?.map((t) => (t.id === id ? fn(t) : t)));
  patchTopic(qc, id, fn);
}

/** Vote, change or (with null) withdraw a poll vote, through the Talk API. */
export function useFeedVote(topicId: string) {
  const qc = useQueryClient();
  const set = (poll: Poll) => patchFeedTopic(qc, topicId, (t) => ({ ...t, poll }));
  return useMutation({
    mutationFn: (optionId: string | null) => (optionId
      ? api.post<VoteResponse>(`/api/talk/topics/${topicId}/vote`, { optionId })
      : api.delete<VoteResponse>(`/api/talk/topics/${topicId}/vote`)),
    onSuccess: ({ poll }) => set(poll),
  });
}

export function useFeedTopicUpvote(topicId: string) {
  const qc = useQueryClient();
  const flip = (t: TopicSummary) => ({ ...t, upvoted: !t.upvoted, upvotes: Math.max(0, t.upvotes + (t.upvoted ? -1 : 1)) });
  return useMutation({
    mutationFn: () => api.post<UpvoteResponse>(`/api/talk/topics/${topicId}/upvote`),
    onMutate: () => patchFeedTopic(qc, topicId, flip),
    onError: () => patchFeedTopic(qc, topicId, flip),
    onSuccess: (res) => patchFeedTopic(qc, topicId, (t) => ({ ...t, upvoted: res.upvoted, upvotes: res.upvotes })),
  });
}

/** Upvote or remove an upvote on the recommendation a feed card shows. */
export function useFeedRecUpvote(recommendationId: string) {
  const qc = useQueryClient();
  const set = (upvoted: boolean, upvotes?: number) => patchFeed(qc, (item) => {
    if (item.type !== 'recommendation' || item.recommendation.id !== recommendationId) return item;
    const r = item.recommendation;
    const count = upvotes ?? Math.max(0, r.upvotes + (upvoted === r.upvotedByMe ? 0 : upvoted ? 1 : -1));
    return { ...item, recommendation: { ...r, upvotedByMe: upvoted, upvotes: count } };
  });
  return useMutation({
    mutationFn: (upvote: boolean) => (upvote
      ? api.put<UpvoteResponse>(`/api/recommendations/${recommendationId}/upvote`)
      : api.delete<UpvoteResponse>(`/api/recommendations/${recommendationId}/upvote`)),
    onMutate: (upvote) => set(upvote),
    onError: (_err, upvote) => set(!upvote),
    onSuccess: (res) => set(res.upvoted, res.upvotes),
    onSettled: () => qc.invalidateQueries({ queryKey: ['listings', 'recs'] }),
  });
}
