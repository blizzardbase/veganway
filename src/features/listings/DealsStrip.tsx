// "Deals now": unexpired offers, newest first, as one quiet sideways scrolling row. For Home: <DealsStrip />.
// While loading it holds the strip's exact height with a skeleton; it renders nothing only when
// the loaded list is empty, so Home stays calm when there are no offers.
import { Link } from 'react-router';
import { Tag as TagIcon } from 'lucide-react';
import { Skeleton } from '../../ui';
import { useDeals } from './api';
import { formatDay } from './bits';
import { listingPath } from '../../../shared/types/listings';

/** One compact deal card: 72 px tall, a saffron tint with a saffron tag and ink text. */
const DEAL_CARD = 'flex h-[72px] w-72 shrink-0 items-center gap-3 rounded-card border px-3 py-2';

/** The same size as the loaded strip (a 24 px heading, an 8 px gap, a 72 px row). */
export function DealsSkeleton() {
  return (
    <div role="status" aria-label="Loading deals" className="flex flex-col gap-2">
      <Skeleton className="h-6 w-28" />
      <div className="-mx-4 flex gap-2 overflow-hidden px-4">
        {[0, 1].map((i) => (
          <div key={i} aria-hidden="true" className={`${DEAL_CARD} border-line bg-surface`}>
            <Skeleton className="size-8 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DealsStrip() {
  const { data, isPending } = useDeals();
  if (isPending) return <DealsSkeleton />;
  if (!data?.length) return null;
  return (
    <section aria-labelledby="deals-h" className="flex flex-col gap-2">
      <h2 id="deals-h" className="text-lg font-extrabold">Deals now</h2>
      <ul className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        {data.map((d) => (
          <li key={d.recommendationId} className="shrink-0">
            <Link
              to={listingPath(d.listing)}
              data-testid="deal-card"
              className={`${DEAL_CARD} border-mono-saffron-2 bg-mono-saffron text-ink transition active:scale-[0.99]`}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-saffron text-on-saffron">
                <TagIcon size={16} aria-hidden="true" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="line-clamp-2 text-sm leading-5 font-extrabold break-words">{d.offer}</span>
                {/* Plain text only: an absolutely positioned sr-only span here would escape the scroller's clip and widen the page. */}
                <span className="truncate text-xs text-muted">{d.listing.name} · until {formatDay(d.offerExpiresAt)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
