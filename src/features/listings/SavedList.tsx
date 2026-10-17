// The member's saved listings, private to them. For the Me screen: <SavedList />.
import { Bookmark } from 'lucide-react';
import { Button, InlineEmpty, ListSkeleton } from '../../ui';
import { errorMessage } from '../../api/client';
import { flatUnique, useBookmarks } from './api';
import { ListingCard } from './ListingCard';

export function SavedList() {
  const q = useBookmarks();
  const items = flatUnique(q.data?.pages);
  if (q.isPending) return <ListSkeleton count={2} label="Loading saved" />;
  if (q.isError) return <p className="text-sm text-muted">{errorMessage(q.error)}</p>;
  if (items.length === 0) return <InlineEmpty icon={Bookmark} line="Nothing saved yet. Tap Save on a place to keep it here." action={{ label: 'Explore', to: '/explore' }} />;
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3" aria-label="Saved">
        {items.map((l) => <li key={l.id}><ListingCard listing={l} /></li>)}
      </ul>
      {q.hasNextPage && (
        <Button variant="secondary" block busy={q.isFetchingNextPage} busyLabel="Loading" onClick={() => void q.fetchNextPage()}>Load more</Button>
      )}
    </div>
  );
}
