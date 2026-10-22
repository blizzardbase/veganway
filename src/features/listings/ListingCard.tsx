import { m, useReducedMotion } from 'motion/react';
import { Link } from 'react-router';
import { MapPin, ShoppingBasket, ThumbsUp } from 'lucide-react';
import { monogramStyle } from '../../ui/monogramRules';
import { membersRecommend } from '../../lib/counts';
import { ListingThumb, OfferBadge, OwnerBadge, VeganStatusTag } from './bits';
import { areaLabel, listingPath, type ListingCard as Card } from '../../../shared/types/listings';

/** One listing in Explore, Saved and other lists. The whole card is one link. */
export function ListingCard({ listing }: { listing: Card }) {
  const still = useReducedMotion();
  const CategoryIcon = monogramStyle(listing.name, listing.category, listing.kind).icon;
  const where = listing.kind === 'product' ? listing.stores.join(', ') : listing.area ? areaLabel(listing.area) : null;
  return (
    <Link
      to={listingPath(listing)}
      data-category={listing.category.toLowerCase() || 'other'}
      className="polished-card listing-card flex gap-3 rounded-card border border-line bg-surface p-3 shadow-1 transition hover:shadow-2 active:scale-[0.99]"
    >
      <m.div layoutId={still ? undefined : `listing-media-${listing.slug}`} className="size-16 shrink-0 overflow-hidden rounded-card" transition={{ type: 'spring', stiffness: 380, damping: 36 }}>
        <ListingThumb name={listing.name} category={listing.category} kind={listing.kind} photoUrl={listing.photoUrl} />
      </m.div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="line-clamp-2 text-base leading-6 font-extrabold break-words">{listing.name}</h3>
        {(where || listing.category) && (
          <p className="flex min-w-0 items-center gap-1 text-sm text-muted">
            {listing.kind === 'product' ? <ShoppingBasket size={14} aria-hidden="true" className="shrink-0" /> : <MapPin size={14} aria-hidden="true" className="shrink-0" />}
            <span className="truncate">{where}</span>
            {listing.category && <><span aria-hidden="true">·</span><CategoryIcon size={14} aria-hidden="true" className="shrink-0" /><span className="truncate">{listing.category}</span></>}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <VeganStatusTag status={listing.veganStatus} />
          <OfferBadge count={listing.activeOfferCount} />
          {listing.runByOwner && <OwnerBadge />}
        </div>
        {listing.recommendCount > 0 && (
          <p className="flex items-center gap-1 pt-0.5 text-sm font-semibold text-ink">
            <ThumbsUp size={14} aria-hidden="true" className="text-warm" />
            {membersRecommend(listing.recommendCount)}
          </p>
        )}
      </div>
    </Link>
  );
}
