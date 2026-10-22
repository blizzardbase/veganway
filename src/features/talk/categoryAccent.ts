import { useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ListingDetail } from '../../../shared/types/listings';
import type { LinkedTopicsResponse, TopicDetail } from '../../../shared/types/talk';

/** Use already loaded links and categories. Presentation must never add a network request. */
export function useCategoryAccent(topicId?: string, listingSlug?: string): string | undefined {
  const client = useQueryClient();
  return useSyncExternalStore(
    (notify) => client.getQueryCache().subscribe(notify),
    () => {
      const topic = topicId ? client.getQueryData<TopicDetail>(['talk', 'topic', topicId]) : undefined;
      const linkedIds = topicId ? client.getQueriesData<LinkedTopicsResponse>({ queryKey: ['talk', 'linked'] })
        .filter(([, data]) => data?.items.some(t => t.id === topicId)).map(([key]) => key[2]) : [];
      const listing = client.getQueriesData<ListingDetail>({ queryKey: ['listings', 'detail'] })
        .map(([, data]) => data).find(l => l && (l.slug === listingSlug || linkedIds.includes(l.id) || topic?.listings.some(link => link.id === l.id)));
      return listing?.category.toLowerCase() || undefined;
    },
    () => undefined,
  );
}
