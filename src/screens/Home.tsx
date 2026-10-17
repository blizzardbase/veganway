// Home: top bar, sticky search, pinned topics, Deals now, and the mixed feed with Load more.
// Its sections appear together once their queries answer (layout shift stays near 0).
// Window focus checks for newer items and offers a "New posts" pill instead of moving the list.
import { Link } from 'react-router';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { ArrowUp, Sparkles, TriangleAlert } from 'lucide-react';
import { Avatar, Button, ButtonLink, EmptyState, SearchPill, Skeleton, Wordmark } from '../ui';
import { useMe } from '../api/session';
import { useAddSheet } from '../features/add/AddSheet';
import { DealsSkeleton, DealsStrip } from '../features/listings/DealsStrip';
import { useDeals } from '../features/listings/api';
import { feedItems, useFeed, useFeedHead, usePinned } from '../features/home/api';
import { FeedSkeleton, ListingAddedCard, PinnedCard, RecommendationCard, TopicCard } from '../features/home/cards';
import { WelcomeCard } from '../features/home/WelcomeCard';
import type { FeedItem } from '../../shared/types/feed';

function FeedCard({ item }: { item: FeedItem }) {
  if (item.type === 'listing_added') return <ListingAddedCard item={item} />;
  if (item.type === 'recommendation') return <RecommendationCard item={item} />;
  return <TopicCard item={item} />;
}

export function Home() {
  const { data: me } = useMe();
  const user = me?.user ?? null;
  const { openAdd } = useAddSheet();
  const feed = useFeed();
  const head = useFeedHead();
  const pinned = usePinned();
  const reduceMotion = useReducedMotion();

  const items = feedItems(feed.data);
  const pins = pinned.data ?? [];
  const deals = useDeals();
  const settled = !feed.isPending && !pinned.isPending && !deals.isPending;
  const firstRun = settled && !feed.isError && items.length === 0 && pins.length === 0;

  // Newer than anything shown, and not already in the list: offer it rather than jump the list.
  const newest = head.data;
  const hasNew = Boolean(
    newest && feed.data && !feed.isFetching
    && !items.some((i) => i.id === newest.id)
    && (!items[0] || Date.parse(newest.at) >= Date.parse(items[0].at)),
  );

  const showNew = async () => {
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    await Promise.all([feed.refetch(), pinned.refetch()]);
  };

  return (
    <>
      <header className="flex h-14 items-center justify-between gap-3">
        <h1 className="sr-only">Home</h1>
        <Link to="/" aria-label="VeganWay DXB home" className="-ml-1 flex h-11 items-center rounded-input px-1">
          <Wordmark />
        </Link>
        {user ? (
          <Link to="/me" aria-label={`Me: ${user.displayName || user.pseudonym}`} className="flex size-11 items-center justify-center rounded-full">
            <Avatar name={user.displayName || user.pseudonym} size="sm" className="size-9" />
          </Link>
        ) : me ? (
          <ButtonLink to="/join?next=%2F" size="md" className="px-5">Join</ButtonLink>
        ) : <span className="size-11" aria-hidden="true" />}
      </header>

      <div className="sticky top-0 z-30 -mx-4 bg-bg/95 px-4 py-2 backdrop-blur">
        <SearchPill />
      </div>

      <AnimatePresence>
        {hasNew && (
          <m.div
            key="new-posts"
            className="pointer-events-none sticky top-[68px] z-40 -mb-11 flex justify-center"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
          >
            <button
              type="button"
              onClick={() => void showNew()}
              className="pointer-events-auto inline-flex h-11 items-center gap-1.5 rounded-full bg-brand px-4 text-sm font-extrabold text-on-brand shadow-3"
            >
              <ArrowUp size={16} aria-hidden="true" />
              New posts
            </button>
          </m.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col gap-6 pt-2">
        {me && !user && (
          <p className="flex items-center gap-3 rounded-card bg-brand-soft py-1 pr-1 pl-4 text-sm font-semibold" data-testid="join-banner">
            <span className="min-w-0 flex-1">Join to add and vote. Any email works.</span>
            <ButtonLink to="/join?next=%2F" variant="ghost" size="md" className="shrink-0">Join</ButtonLink>
          </p>
        )}

        {/* One swap from skeleton to content once pinned, deals and the feed have all answered, so
            no section that arrives late pushes the feed down under the reader's thumb. */}
        {!settled ? (
          <div key="loading" className="flex flex-col gap-6">
            <DealsSkeleton />
            <div className="flex flex-col gap-3">
              <Skeleton className="h-6 w-48" />
              <FeedSkeleton />
            </div>
          </div>
        ) : (
          <div key="ready" className="flex flex-col gap-6">
            {pins.length > 0 && (
              <section aria-labelledby="pinned-h" className="flex flex-col gap-2">
                <h2 id="pinned-h" className="text-lg font-extrabold">Pinned</h2>
                <ul className="flex flex-col gap-2">
                  {pins.map((t) => <li key={t.id}><PinnedCard topic={t} /></li>)}
                </ul>
              </section>
            )}

            <DealsStrip />

            {firstRun ? (
              <WelcomeCard />
            ) : (
              <section aria-labelledby="feed-h" className="flex flex-col gap-3">
                <h2 id="feed-h" className="flex items-center gap-2 text-lg font-extrabold">
                  <Sparkles size={18} aria-hidden="true" className="text-brand" />
                  Latest from members
                </h2>
                {feed.isError && !items.length ? (
                  <EmptyState icon={TriangleAlert} line="The feed did not load. Check your connection." action={{ label: 'Try again', onClick: () => void feed.refetch() }} />
                ) : items.length === 0 ? (
                  <EmptyState icon={Sparkles} line="Nothing new yet. Add the first find." action={{ label: 'Add something', onClick: openAdd }} />
                ) : (
                  <>
                    <ul className="flex flex-col gap-3">
                      {items.map((item) => <li key={item.id}><FeedCard item={item} /></li>)}
                    </ul>
                    {feed.isFetchingNextPage && <FeedSkeleton label="Loading more" />}
                    {feed.hasNextPage && !feed.isFetchingNextPage && (
                      <Button variant="secondary" block onClick={() => void feed.fetchNextPage()}>Load more</Button>
                    )}
                    {!feed.hasNextPage && items.length > 5 && (
                      <p className="py-2 text-center text-sm text-muted">You are all caught up.</p>
                    )}
                  </>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </>
  );
}
