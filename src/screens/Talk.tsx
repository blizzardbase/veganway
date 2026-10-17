// Talk: discussions and polls, Hot or New, with tag chips and Load more.
import { useSearchParams } from 'react-router';
import { MessagesSquare, Plus } from 'lucide-react';
import type { TopicSort } from '../../shared/types/talk';
import { Button, ButtonLink, Chip, ChipRow, EmptyState, Segmented, TopBar } from '../ui';
import { errorMessage } from '../api/client';
import { useTags, useTopics } from '../features/talk/api';
import { TopicListSkeleton, TopicRow } from '../features/talk/TopicRow';

const SORTS = [
  { value: 'hot' as const, label: 'Hot' },
  { value: 'new' as const, label: 'New' },
];

export function Talk() {
  // Sort and tag live in the URL so Back returns to the same list.
  const [params, setParams] = useSearchParams();
  const sort: TopicSort = params.get('sort') === 'new' ? 'new' : 'hot';
  const tag = params.get('tag') || null;
  const topics = useTopics(sort, tag);
  const tags = useTags();

  const update = (next: { sort?: TopicSort; tag?: string | null }) => {
    const p = new URLSearchParams(params);
    const s = next.sort ?? sort;
    const t = next.tag === undefined ? tag : next.tag;
    if (s === 'hot') p.delete('sort');
    else p.set('sort', s);
    if (t) p.set('tag', t);
    else p.delete('tag');
    setParams(p, { replace: true });
  };

  const items = topics.data?.pages.flatMap((p) => p.items) ?? [];
  const tagList = [...new Set([...(tag ? [tag] : []), ...(tags.data ?? [])])];

  return (
    <>
      <TopBar
        title="Talk"
        actions={<ButtonLink to="/add/discussion" size="md" variant="ghost" aria-label="Start a discussion"><Plus size={20} aria-hidden="true" />Start</ButtonLink>}
      />
      <div className="flex flex-col gap-3">
        <Segmented label="Sort discussions" options={SORTS} value={sort} onChange={(s) => update({ sort: s })} />
        {tagList.length > 0 && (
          <ChipRow label="Filter by tag">
            <Chip selected={!tag} onClick={() => update({ tag: null })}>All</Chip>
            {tagList.map((t) => (
              <Chip key={t} selected={tag === t} onClick={() => update({ tag: tag === t ? null : t })}>#{t}</Chip>
            ))}
          </ChipRow>
        )}
        {topics.isPending && <TopicListSkeleton count={4} />}
        {topics.isError && (
          <EmptyState icon={MessagesSquare} line={errorMessage(topics.error)} action={{ label: 'Try again', onClick: () => void topics.refetch() }} />
        )}
        {topics.isSuccess && items.length === 0 && (
          tag
            ? <EmptyState icon={MessagesSquare} line={`No discussions tagged ${tag} yet.`} action={{ label: 'Show all', onClick: () => update({ tag: null }) }} />
            : <EmptyState icon={MessagesSquare} line="No discussions yet. Start the first one." action={{ label: 'Start a discussion', to: '/add/discussion' }} />
        )}
        {items.length > 0 && (
          <ul className="flex flex-col gap-3" aria-label="Discussions">
            {items.map((t) => <li key={t.id}><TopicRow topic={t} /></li>)}
          </ul>
        )}
        {topics.hasNextPage && (
          <Button variant="secondary" block busy={topics.isFetchingNextPage} busyLabel="Loading" onClick={() => void topics.fetchNextPage()}>
            Load more
          </Button>
        )}
      </div>
    </>
  );
}
