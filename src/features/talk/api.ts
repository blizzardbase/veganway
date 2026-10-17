// React Query hooks for the talk API (server/routes/talk.ts).
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type {
  CreateReplyBody, CreateTopicBody, LinkedTopicsResponse, PinResponse, Poll, RepliesResponse, ReplyResponse, ReplyTargetType,
  TagsResponse, TopicDetail, TopicListResponse, TopicResponse, TopicSort, TopicSummary, UpvoteResponse, VoteResponse,
} from '../../../shared/types/talk';

export const talkKeys = {
  all: ['talk'] as const,
  lists: ['talk', 'topics'] as const,
  list: (sort: TopicSort, tag: string | null) => ['talk', 'topics', sort, tag ?? ''] as const,
  topic: (id: string) => ['talk', 'topic', id] as const,
  tags: ['talk', 'tags'] as const,
  linked: (listingId: string) => ['talk', 'linked', listingId] as const,
  replies: (type: ReplyTargetType, id: string) => ['talk', 'replies', type, id] as const,
};

export function useTopics(sort: TopicSort, tag: string | null) {
  return useInfiniteQuery({
    queryKey: talkKeys.list(sort, tag),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ sort });
      if (tag) qs.set('tag', tag);
      if (pageParam) qs.set('cursor', pageParam);
      return api.get<TopicListResponse>(`/api/talk/topics?${qs}`);
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useTopic(id: string | undefined) {
  return useQuery({
    queryKey: talkKeys.topic(id ?? ''),
    queryFn: async () => (await api.get<TopicResponse>(`/api/talk/topics/${encodeURIComponent(id!)}`)).topic,
    enabled: Boolean(id),
  });
}

export function useTags() {
  return useQuery({
    queryKey: talkKeys.tags,
    queryFn: async () => (await api.get<TagsResponse>('/api/talk/tags')).tags,
    staleTime: 5 * 60_000,
  });
}

export function useLinkedTopics(listingId: string) {
  return useQuery({
    queryKey: talkKeys.linked(listingId),
    queryFn: () => api.get<LinkedTopicsResponse>(`/api/talk/linked?listing_id=${encodeURIComponent(listingId)}`),
  });
}

/** Apply a change to one topic wherever it is cached: lists, linked lists and its detail. */
export function patchTopic(qc: QueryClient, id: string, fn: (t: TopicSummary) => TopicSummary): void {
  qc.setQueriesData<InfiniteData<TopicListResponse>>({ queryKey: talkKeys.lists }, (data) => data && {
    ...data,
    pages: data.pages.map((p) => ({ ...p, items: p.items.map((t) => (t.id === id ? fn(t) : t)) })),
  });
  qc.setQueriesData<LinkedTopicsResponse>({ queryKey: ['talk', 'linked'] }, (data) => data && {
    ...data,
    items: data.items.map((t) => (t.id === id ? fn(t) : t)),
  });
  qc.setQueryData<TopicDetail>(talkKeys.topic(id), (t) => t && { ...t, ...fn(t) });
}

export function useCreateTopic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTopicBody) => api.post<TopicResponse>('/api/talk/topics', body),
    onSuccess: async ({ topic }) => {
      qc.setQueryData(talkKeys.topic(topic.id), topic);
      await qc.invalidateQueries({ queryKey: talkKeys.lists });
      await qc.invalidateQueries({ queryKey: talkKeys.tags });
      await qc.invalidateQueries({ queryKey: ['talk', 'linked'] });
    },
  });
}

export function useVote(topicId: string) {
  const qc = useQueryClient();
  const set = (poll: Poll) => patchTopic(qc, topicId, (t) => ({ ...t, poll }));
  return useMutation({
    mutationFn: (optionId: string | null) => (optionId
      ? api.post<VoteResponse>(`/api/talk/topics/${topicId}/vote`, { optionId })
      : api.delete<VoteResponse>(`/api/talk/topics/${topicId}/vote`)),
    onSuccess: ({ poll }) => set(poll),
  });
}

export function useTopicUpvote(topicId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<UpvoteResponse>(`/api/talk/topics/${topicId}/upvote`),
    onMutate: () => patchTopic(qc, topicId, (t) => ({ ...t, upvoted: !t.upvoted, upvotes: t.upvotes + (t.upvoted ? -1 : 1) })),
    onSuccess: (res) => patchTopic(qc, topicId, (t) => ({ ...t, upvoted: res.upvoted, upvotes: res.upvotes })),
    onError: () => patchTopic(qc, topicId, (t) => ({ ...t, upvoted: !t.upvoted, upvotes: t.upvotes + (t.upvoted ? -1 : 1) })),
  });
}

export function usePin(topicId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pinned: boolean) => api.post<PinResponse>(`/api/talk/topics/${topicId}/pin`, { pinned }),
    onSuccess: async (res) => {
      patchTopic(qc, topicId, (t) => ({ ...t, pinned: res.pinned }));
      await qc.invalidateQueries({ queryKey: talkKeys.lists });
    },
  });
}

export function useReplies(type: ReplyTargetType, id: string) {
  return useQuery({
    queryKey: talkKeys.replies(type, id),
    queryFn: () => api.get<RepliesResponse>(`/api/talk/replies?target_type=${type}&target_id=${encodeURIComponent(id)}`),
  });
}

function bumpReplyCount(qc: QueryClient, type: ReplyTargetType, id: string, by: number) {
  if (type === 'topic') patchTopic(qc, id, (t) => ({ ...t, replyCount: Math.max(0, t.replyCount + by) }));
}

export function useCreateReply(type: ReplyTargetType, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Omit<CreateReplyBody, 'targetType' | 'targetId'>) =>
      api.post<ReplyResponse>('/api/talk/replies', { ...body, targetType: type, targetId: id }),
    onSuccess: async () => {
      bumpReplyCount(qc, type, id, 1);
      await qc.invalidateQueries({ queryKey: talkKeys.replies(type, id) });
    },
  });
}

export function useReplyUpvote(type: ReplyTargetType, id: string) {
  const qc = useQueryClient();
  const flip = (replyId: string, to?: UpvoteResponse) => qc.setQueryData<RepliesResponse>(talkKeys.replies(type, id), (data) => data && {
    ...data,
    items: data.items.map((thread) => {
      const one = <T extends { id: string; upvoted: boolean; upvotes: number }>(r: T): T => (r.id !== replyId ? r
        : to ? { ...r, upvoted: to.upvoted, upvotes: to.upvotes }
          : { ...r, upvoted: !r.upvoted, upvotes: r.upvotes + (r.upvoted ? -1 : 1) });
      return { ...one(thread), replies: thread.replies.map(one) };
    }),
  });
  return useMutation({
    mutationFn: (replyId: string) => api.post<UpvoteResponse>(`/api/talk/replies/${replyId}/upvote`),
    onMutate: (replyId) => flip(replyId),
    onSuccess: (res, replyId) => flip(replyId, res),
    onError: (_err, replyId) => flip(replyId),
  });
}

/** POST /api/reports, owned by the admin slice. */
export function useReport() {
  return useMutation({
    mutationFn: (body: { target_type: 'topic' | 'reply'; target_id: string; reason: string }) => api.post<unknown>('/api/reports', body),
  });
}
