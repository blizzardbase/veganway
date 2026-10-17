// The member's saved listings, private to them. For the Me screen: <SavedList />.
import { Bookmark } from 'lucide-react';
import { Button, InlineEmpty, ListSkeleton } from '../../ui';
import { flatUnique, useBookmarks } from './api';
import { ListingCard } from './ListingCard';

export function SavedList() {
  const q = useBookmarks();
  const items = flatUnique(q.data?.pages);
  if (q.isPending) return <ListSkeleton count={2} label="Loading saved" />;
  if (items.length === 0 && !q.isError) return <InlineEmpty icon={Bookmark} line="Nothing saved yet. Tap Save on a place to keep it here." action={{ label: 'Explore', to: '/explore' }} />;
  return (
    <div className="flex flex-col gap-3">
      {q.isError && (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-sm text-danger">Could not load your saved places.</p>
          <Button variant="secondary" size="md" busy={q.isFetching} busyLabel="Retrying" onClick={() => void q.refetch()}>Retry</Button>
        </div>
      )}
      {items.length > 0 && <ul className="flex flex-col gap-3" aria-label="Saved">
        {items.map((l) => <li key={l.id}><ListingCard listing={l} /></li>)}
      </ul>}
      {q.hasNextPage && (
        <Button variant="secondary" block busy={q.isFetchingNextPage} busyLabel="Loading" onClick={() => void q.fetchNextPage()}>Load more</Button>
      )}
    </div>
  );
}
