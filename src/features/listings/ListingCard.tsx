import { Link } from 'react-router';
import { MapPin, ShoppingBasket, ThumbsUp } from 'lucide-react';
import { membersRecommend } from '../../lib/counts';
import { ListingThumb, OfferBadge, OwnerBadge, VeganStatusTag } from './bits';
import { listingPath, type ListingCard as Card } from '../../../shared/types/listings';

/** One listing in Explore, Saved and other lists. The whole card is one link. */
export function ListingCard({ listing }: { listing: Card }) {
  const where = listing.kind === 'product' ? listing.stores.join(', ') : listing.area;
  return (
    <Link
      to={listingPath(listing)}
      className="flex gap-3 rounded-card border border-line bg-surface p-3 shadow-1 transition hover:shadow-2 active:scale-[0.99]"
    >
      <ListingThumb name={listing.name} category={listing.category} kind={listing.kind} photoUrl={listing.photoUrl} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h3 className="line-clamp-2 text-base leading-6 font-extrabold break-words">{listing.name}</h3>
        {where && (
          <p className="flex min-w-0 items-center gap-1 text-sm text-muted">
            {listing.kind === 'product' ? <ShoppingBasket size={14} aria-hidden="true" className="shrink-0" /> : <MapPin size={14} aria-hidden="true" className="shrink-0" />}
            <span className="truncate">{where}</span>
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <VeganStatusTag status={listing.veganStatus} />
          <OfferBadge count={listing.activeOfferCount} />
          {listing.runByOwner && <OwnerBadge />}
        </div>
        {listing.recommendCount > 0 && (
          <p className="flex items-center gap-1 pt-0.5 text-sm font-semibold text-ink">
            <ThumbsUp size={14} aria-hidden="true" className="text-brand" />
            {membersRecommend(listing.recommendCount)}
          </p>
        )}
      </div>
    </Link>
  );
}
