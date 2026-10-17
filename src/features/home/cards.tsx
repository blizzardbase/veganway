// The feed's card types: a new listing, a recommendation (or a collapsed burst of them), a topic,
// plus compact pinned cards and skeletons shaped like each card.
import { Link } from 'react-router';
import {
  ChartColumnBig, ChefHat, ChevronRight, MapPin, MessageCircle, MessagesSquare, Pin, ShoppingBasket, Store, Tag as TagIcon, ThumbsUp,
  type LucideIcon,
} from 'lucide-react';
import { Avatar, Monogram, monogramStyle, monoTileClass, Skeleton, Tag } from '../../ui';
import { cx } from '../../lib/cx';
import { membersRecommend, replyCount } from '../../lib/counts';
import { useRequireAccount } from '../auth/Gate';
import { OfferBadge, OwnerBadge, VeganStatusTag, formatDay } from '../listings/bits';
import { UpvoteButton } from '../talk/UpvoteButton';
import { age } from '../talk/format';
import { listingPath, type ListingKind } from '../../../shared/types/listings';
import type { FeedListing, FeedListingAdded, FeedRecommendation, FeedTopic } from '../../../shared/types/feed';
import type { TopicSummary } from '../../../shared/types/talk';
import { useFeedRecUpvote, useFeedTopicUpvote } from './api';
import { FeedPoll } from './FeedPoll';

const KIND: Record<ListingKind, { label: string; icon: LucideIcon }> = {
  place: { label: 'New place', icon: Store },
  product: { label: 'New product', icon: ShoppingBasket },
  service: { label: 'New service', icon: ChefHat },
};

const CARD = 'overflow-hidden rounded-card border border-line bg-surface shadow-1';

function whereOf(l: Pick<FeedListing, 'kind' | 'area' | 'stores'>): string {
  return l.kind === 'product' ? l.stores.join(', ') : l.area ?? '';
}

/** "New place · 3h": what the card is and when it happened. */
function Kicker({ icon: Icon, label, at, className }: { icon: LucideIcon; label: string; at: string; className?: string }) {
  return (
    <p className={cx('flex min-w-0 items-center gap-1.5 text-xs font-extrabold tracking-wide text-brand uppercase', className)}>
      <Icon size={14} aria-hidden="true" className="shrink-0" />
      <span className="truncate">{label}</span>
      <span aria-hidden="true" className="text-muted">·</span>
      <time dateTime={at} className="shrink-0 font-semibold text-muted normal-case">{age(at)}</time>
    </p>
  );
}

function Where({ listing }: { listing: Pick<FeedListing, 'kind' | 'area' | 'stores'> }) {
  const where = whereOf(listing);
  if (!where) return null;
  const Icon = listing.kind === 'product' ? ShoppingBasket : MapPin;
  return (
    <p className="flex min-w-0 items-center gap-1 text-sm text-muted">
      <Icon size={14} aria-hidden="true" className="shrink-0" />
      <span className="truncate">{where}</span>
    </p>
  );
}

// ---------- new listing ----------

/** The listing's photo, or its category monogram, at a fixed small size. */
function Thumb({ listing, size }: { listing: FeedListing; size: 'sm' | 'md' }) {
  if (listing.photoUrl) {
    return <img src={listing.photoUrl} alt="" loading="lazy" decoding="async" className={cx('shrink-0 bg-surface-2 object-cover', size === 'md' ? 'size-16 rounded-card' : 'size-6 rounded-full')} />;
  }
  if (size === 'sm') {
    const { icon: Icon, tone } = monogramStyle(listing.name, listing.category, listing.kind);
    return (
      <span aria-hidden="true" data-tone={tone} className={cx('flex size-6 shrink-0 items-center justify-center rounded-full', monoTileClass(tone))}>
        <Icon size={14} strokeWidth={2.2} />
      </span>
    );
  }
  return <Monogram name={listing.name} category={listing.category} kind={listing.kind} size="md" />;
}

export function ListingAddedCard({ item }: { item: FeedListingAdded }) {
  const { listing, addedBy, whatToOrder } = item;
  const kind = KIND[listing.kind];
  return (
    <article data-testid="feed-item" data-type="listing_added">
      <Link to={listingPath(listing)} className={cx(CARD, 'flex flex-col gap-2 p-3 transition hover:shadow-2 active:scale-[0.99]')}>
        <div className="flex gap-3">
          <Thumb listing={listing} size="md" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <Kicker icon={kind.icon} label={kind.label} at={item.at} />
            <h3 className="line-clamp-1 text-base font-extrabold break-words">{listing.name}</h3>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <Where listing={listing} />
              <VeganStatusTag status={listing.veganStatus} />
              <OfferBadge count={listing.activeOfferCount} />
              {listing.runByOwner && <OwnerBadge />}
            </div>
          </div>
        </div>
        {whatToOrder && (
          <p className="line-clamp-2 text-sm break-words">
            <span className="font-extrabold">What to order: </span>
            {whatToOrder}
          </p>
        )}
        <div className="flex items-center gap-3 text-xs">
          <span className="min-w-0 flex-1 truncate text-muted">Added by {addedBy.displayName || addedBy.pseudonym}</span>
          {listing.recommendCount > 0 && (
            <span className="flex shrink-0 items-center gap-1 font-bold">
              <ThumbsUp size={12} aria-hidden="true" className="text-brand" />
              {membersRecommend(listing.recommendCount)}
            </span>
          )}
        </div>
      </Link>
    </article>
  );
}

// ---------- recommendation ----------

/** "Saffron Chickpea", or "A, B and 2 more" for a collapsed burst; the verb follows. */
function whoRecommends(item: FeedRecommendation): { who: string; verb: string } {
  const first = item.recommendation.author.displayName || item.recommendation.author.pseudonym;
  if (item.count <= 1) return { who: first, verb: 'recommends' };
  const names = (item.authors.length ? item.authors : [first]).slice(0, 2);
  const rest = item.count - names.length;
  const parts = rest > 0 ? [...names, `${rest} more`] : names;
  if (parts.length === 1) return { who: parts[0], verb: 'recommends' };
  return { who: `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`, verb: 'recommend' };
}

/**
 * About 140 px: who recommends what on one line, a two line quote, a compact listing chip and the
 * counts in one row. One link (the listing); the upvote sits beside it, never inside it.
 */
export function RecommendationCard({ item }: { item: FeedRecommendation }) {
  const { listing, recommendation: rec } = item;
  const upvote = useFeedRecUpvote(rec.id);
  const requireAccount = useRequireAccount();
  const { who, verb } = whoRecommends(item);
  return (
    <article data-testid="feed-item" data-type="recommendation" className={cx(CARD, 'relative')}>
      <Link to={listingPath(listing)} className="flex flex-col gap-2 p-3 transition active:scale-[0.99]">
        <div className="flex min-w-0 items-center gap-2 pr-11">
          <Avatar name={rec.author.pseudonym} src={rec.author.avatarUrl} size="sm" className="size-7" />
          <h3 className="min-w-0 flex-1 truncate text-sm">
            <span className="font-extrabold">{who}</span>
            <span className="text-muted"> {verb} </span>
            <span className="font-extrabold">{listing.name}</span>
          </h3>
          <time dateTime={item.at} className="shrink-0 text-xs text-muted">{age(item.at)}</time>
        </div>
        {rec.excerpt && <p className="line-clamp-2 text-sm leading-5 break-words">“{rec.excerpt}”</p>}
        {rec.offer && rec.offerExpiresAt && (
          <p className="flex min-w-0 items-center gap-1.5 self-start rounded-full bg-saffron py-0.5 pr-2.5 pl-2 text-xs text-on-saffron">
            <TagIcon size={12} aria-hidden="true" className="shrink-0" />
            <span className="truncate"><span className="font-extrabold">{rec.offer}</span> until {formatDay(rec.offerExpiresAt)}</span>
          </p>
        )}
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex h-7 min-w-0 items-center gap-1.5 rounded-full bg-surface-2 pr-2.5 pl-0.5 text-xs">
            <Thumb listing={listing} size="sm" />
            <span className="truncate font-bold">{listing.name}</span>
          </span>
          {listing.recommendCount > 0 && (
            <span className="ml-auto flex shrink-0 items-center gap-1 text-xs font-bold text-muted">
              <ThumbsUp size={12} aria-hidden="true" className="text-brand" />
              {membersRecommend(listing.recommendCount)}
            </span>
          )}
        </div>
        {item.count > 1 && <p className="-mt-1 text-xs text-muted">{item.count} recommendations within an hour</p>}
      </Link>
      <div className="absolute top-0.5 right-0.5">
        <UpvoteButton
          label="Upvote recommendation"
          iconOnly
          count={rec.upvotes}
          upvoted={rec.upvotedByMe}
          onToggle={() => requireAccount(() => upvote.mutate(!rec.upvotedByMe))}
        />
      </div>
    </article>
  );
}

// ---------- topic ----------

export function TopicCard({ item }: { item: FeedTopic }) {
  const { topic } = item;
  const upvote = useFeedTopicUpvote(topic.id);
  const requireAccount = useRequireAccount();
  const href = `/talk/${topic.id}`;
  const poll = topic.kind === 'poll';
  const replies = replyCount(topic.replyCount);
  return (
    <article data-testid="feed-item" data-type="topic" className={cx(CARD, 'flex flex-col gap-2 p-3')}>
      <Kicker icon={poll ? ChartColumnBig : MessagesSquare} label={poll ? 'Poll' : 'Discussion'} at={item.at} />
      <Link to={href} className="-m-1 flex min-h-11 flex-col justify-center gap-0.5 rounded-input p-1">
        <h3 className="line-clamp-2 text-base font-extrabold break-words">{topic.title}</h3>
        {topic.excerpt && <p className="line-clamp-2 text-sm text-muted break-words">{topic.excerpt}</p>}
      </Link>
      {topic.poll && <FeedPoll topicId={topic.id} poll={topic.poll} />}
      <div className="-my-1.5 -ml-3 flex items-center gap-1 text-sm text-muted">
        <UpvoteButton count={topic.upvotes} upvoted={topic.upvoted} onToggle={() => requireAccount(() => upvote.mutate())} />
        <Link
          to={href}
          aria-label={replies ?? 'Reply'}
          className="inline-flex h-11 min-w-11 items-center justify-center gap-1 rounded-full px-3 font-bold hover:bg-surface-2 hover:text-ink"
        >
          <MessageCircle size={18} aria-hidden="true" />
          {topic.replyCount > 0 && <span className="tabular-nums">{topic.replyCount}</span>}
        </Link>
        <span className="ml-auto min-w-0 truncate text-xs">{topic.author.name}</span>
      </div>
    </article>
  );
}

// ---------- pinned ----------

export function PinnedCard({ topic }: { topic: TopicSummary }) {
  return (
    <Link
      to={`/talk/${topic.id}`}
      className="flex min-h-14 items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 shadow-1 transition hover:shadow-2 active:scale-[0.99]"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-saffron text-on-saffron">
        <Pin size={16} aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="line-clamp-2 text-sm font-extrabold break-words">{topic.title}</span>
        <span className="flex items-center gap-1.5 text-xs text-muted">
          {topic.kind === 'poll' && <Tag className="py-0">Poll</Tag>}
          {replyCount(topic.replyCount) ?? 'Be the first to reply'}
        </span>
      </span>
      <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-muted" />
    </Link>
  );
}

// ---------- skeletons ----------

function ListingSkeleton() {
  return (
    <div aria-hidden="true" className={cx(CARD, 'flex gap-3 p-3')}>
      <Skeleton className="size-16 rounded-card" />
      <div className="flex flex-1 flex-col gap-2 pt-1">
        <Skeleton className="h-3 w-1/4" />
        <Skeleton className="h-5 w-3/5" />
        <Skeleton className="h-3 w-2/5" />
      </div>
    </div>
  );
}

function RecommendationSkeleton() {
  return (
    <div aria-hidden="true" className={cx(CARD, 'flex flex-col gap-2 p-3')}>
      <div className="flex items-center gap-2">
        <Skeleton className="size-7 rounded-full" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-7 w-2/5 rounded-full" />
    </div>
  );
}

function TopicSkeleton() {
  return (
    <div aria-hidden="true" className={cx(CARD, 'flex flex-col gap-3 p-4')}>
      <Skeleton className="h-3 w-1/4" />
      <Skeleton className="h-5 w-4/5" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
    </div>
  );
}

/** Card shaped placeholders, one of each kind, while the feed loads. */
export function FeedSkeleton({ label = 'Loading the feed' }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-3">
      <ListingSkeleton />
      <RecommendationSkeleton />
      <TopicSkeleton />
    </div>
  );
}
