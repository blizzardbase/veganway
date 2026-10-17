// Place or product detail. A service slug opens the services screen instead.
// No tab bar here: a top bar with Back, Share, Save and Report, and one sticky bar at the bottom
// with Recommend, Not for me and Add yours.
import { Link, Navigate, useParams } from 'react-router';
import { Bookmark, ExternalLink, MapPin, Plus, SearchX, Share2, ShoppingBasket, Tag as TagIcon } from 'lucide-react';
import { EmptyState, HeroMedia, IconButton, ListSkeleton, Tag, TopBar, useToast } from '../ui';
import { ApiError, errorMessage } from '../api/client';
import { useRequireAccount } from '../features/auth/Gate';
import { useListing, useSetSaved } from '../features/listings/api';
import { OfferBadge, OwnerBadge, VeganStatusTag, formatDay } from '../features/listings/bits';
import { ListingActionBar, OpinionSummary } from '../features/listings/OpinionBar';
import { Recommendations } from '../features/listings/Recommendations';
import { ReportButton } from '../features/listings/ReportSheet';
import { ListingTalk } from '../features/listings/TalkSlots';
import { areaLabel, listingPath, type ListingDetail as Detail } from '../../shared/types/listings';

/** A plain wa.me link: no script, no tracking. */
export function whatsappShareUrl(name: string, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${name} ${url}`)}`;
}

function SaveButton({ listing }: { listing: Detail }) {
  const setSaved = useSetSaved(listing.slug);
  const toast = useToast();
  const requireAccount = useRequireAccount();
  return (
    <IconButton
      label={listing.saved ? 'Saved' : 'Save'}
      aria-pressed={listing.saved}
      onClick={() => requireAccount(() => {
        const next = !listing.saved;
        setSaved.mutate(next, {
          onSuccess: () => toast.show({ message: next ? 'Saved. Find it in Me.' : 'Removed from saved.', onUndo: () => setSaved.mutate(!next) }),
          onError: (err) => toast.show({ message: errorMessage(err) }),
        });
      })}
    >
      <Bookmark size={22} aria-hidden="true" className={listing.saved ? 'fill-current text-brand' : undefined} />
    </IconButton>
  );
}

export function ListingDetail() {
  const { slug } = useParams();
  const q = useListing(slug);
  const parent = typeof window !== 'undefined' && window.location.pathname.startsWith('/products/') ? '/explore?kind=product' : '/explore';

  if (q.isPending) return <><TopBar back={parent} /><ListSkeleton count={3} label="Loading" /></>;
  if (q.isError) {
    const missing = q.error instanceof ApiError && q.error.status === 404;
    return (
      <>
        <TopBar back={parent} />
        <EmptyState
          icon={SearchX}
          line={missing ? 'This listing is not here any more.' : errorMessage(q.error)}
          action={missing ? { label: 'Explore', to: '/explore' } : { label: 'Try again', onClick: () => void q.refetch() }}
        />
      </>
    );
  }
  const l = q.data;
  if (l.kind === 'service') return <Navigate to={listingPath(l)} replace />;

  const url = typeof window === 'undefined' ? listingPath(l) : `${window.location.origin}${listingPath(l)}`;
  const where = l.kind === 'product' ? l.stores.join(', ') : l.area ? areaLabel(l.area) : null;
  const offerPath = `/add/offer?listing=${encodeURIComponent(l.slug)}`;

  return (
    <>
      <TopBar
        back={parent}
        actions={(
          <>
            <a
              href={whatsappShareUrl(l.name, url)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Share on WhatsApp"
              title="Share on WhatsApp"
              className="inline-flex size-11 items-center justify-center rounded-full text-ink transition hover:bg-surface-2"
            >
              <Share2 size={22} aria-hidden="true" />
            </a>
            <SaveButton listing={l} />
            <ReportButton targetType="listing" targetId={l.id} />
          </>
        )}
      />

      <article className="flex flex-col gap-5">
        <div data-testid="listing-photo">
          <HeroMedia name={l.name} category={l.category} kind={l.kind} photoUrl={l.photoUrl} className="-mt-2" />
          {l.photoUrl && <div className="flex justify-end"><ReportButton targetType="photo" photoUrl={l.photoUrl} variant="text" /></div>}
        </div>

        <header className="flex flex-col gap-2">
          <h1 className="text-[28px] leading-[34px] font-extrabold break-words">{l.name}</h1>
          <div className="flex flex-wrap items-center gap-1.5">
            <VeganStatusTag status={l.veganStatus} />
            {l.category && <Tag tone="plain">{l.category}</Tag>}
            <OfferBadge count={l.activeOfferCount} />
            {l.runByOwner && <OwnerBadge />}
            {l.hidden && <Tag tone="plain">Hidden</Tag>}
          </div>
          {where && (
            <p className="flex items-center gap-1.5 text-base text-muted">
              {l.kind === 'product' ? <ShoppingBasket size={18} aria-hidden="true" /> : <MapPin size={18} aria-hidden="true" />}
              {where}
            </p>
          )}
          <OpinionSummary count={l.recommendCount} />
          {l.summary && <p className="text-base break-words">{l.summary}</p>}
          {l.mapsUrl && (
            <a
              href={l.mapsUrl}
              target="_blank"
              rel="noopener noreferrer nofollow ugc"
              className="inline-flex h-11 w-fit items-center gap-2 text-base font-bold text-brand underline-offset-4 hover:underline"
            >
              <ExternalLink size={18} aria-hidden="true" />
              Open in maps
            </a>
          )}
          <p className="text-sm text-muted">Added by {l.createdBy.displayName || l.createdBy.pseudonym} on {formatDay(l.createdAt)}</p>
        </header>

        <section aria-labelledby="offers-h" className="flex flex-col gap-2">
          {l.offers.length > 0 ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <h2 id="offers-h" className="text-lg font-extrabold">Offers now</h2>
                <Link to={offerPath} className="inline-flex h-11 items-center gap-1 px-1 text-sm font-bold text-brand">
                  <Plus size={16} aria-hidden="true" /> Add an offer
                </Link>
              </div>
              <ul className="flex flex-col gap-2">
                {l.offers.map((o) => (
                  <li key={o.recommendationId} className="flex items-start gap-2 rounded-card bg-saffron p-4 text-on-saffron">
                    <TagIcon size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-bold break-words">{o.offer}</p>
                      <p className="text-sm">Until {formatDay(o.offerExpiresAt)} · shared by {o.author.displayName || o.author.pseudonym}</p>
                      <ReportButton targetType="recommendation" targetId={o.recommendationId} variant="text" />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <h2 id="offers-h" className="sr-only">Offers</h2>
              <Link
                to={offerPath}
                className="flex min-h-12 items-center gap-3 rounded-card border border-dashed border-line px-4 py-2 text-sm text-muted transition hover:bg-surface-2"
              >
                <TagIcon size={18} aria-hidden="true" className="shrink-0 text-saffron" />
                <span className="flex-1">Know a deal here?</span>
                <span className="font-bold text-brand">Add an offer</span>
              </Link>
            </>
          )}
        </section>

        <section aria-labelledby="recs-h" className="flex flex-col gap-3">
          <h2 id="recs-h" className="text-lg font-extrabold">Recommendations</h2>
          <Recommendations slug={l.slug} creator={l.createdBy.pseudonym} />
        </section>

        <ListingTalk listingId={l.id} name={l.name} slug={l.slug} kind={l.kind} />
      </article>

      <ListingActionBar listing={l} name={l.name} />
    </>
  );
}
