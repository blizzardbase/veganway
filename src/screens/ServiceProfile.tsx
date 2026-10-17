// A service page: what they offer, the contact links the owner chose, recommendations, replies,
// linked discussions, the claim sheet and the owner's Edit sheet. No tab bar: a top bar with Back,
// and the opinion bar with Add yours as the one sticky element at the bottom.
import { useState } from 'react';
import { useParams } from 'react-router';
import { AtSign, Bookmark, Flag, Globe, MapPin, MessageCircle, Pencil, SearchX, Share2, Store } from 'lucide-react';
import { Button, buttonClass, Card, EmptyState, HeroMedia, IconButton, Tag, TopBar, useToast } from '../ui';
import { ListSkeleton } from '../ui/Skeleton';
import { ApiError, errorMessage } from '../api/client';
import { useRequireAccount } from '../features/auth/Gate';
import { contactLinks, useService } from '../features/services/api';
import { ClaimSheet } from '../features/services/ClaimSheet';
import { EditServiceSheet } from '../features/services/EditServiceSheet';
import { Replies } from '../features/talk/Replies';
import { LinkedTopics } from '../features/talk/LinkedTopics';
import { ListingActionBar, OpinionSummary } from '../features/listings/OpinionBar';
import { Recommendations } from '../features/listings/Recommendations';
import { OwnerBadge, VeganStatusTag } from '../features/listings/bits';
import { useListing, useSetSaved } from '../features/listings/api';
import { ReportSheet } from '../features/admin/ReportSheet';

import { ReportButton } from '../features/listings/ReportSheet';
import { areaLabel } from '../../shared/types/listings';

const LINK_REL = 'noopener noreferrer nofollow ugc';
const ICONS = { whatsapp: MessageCircle, instagram: AtSign, website: Globe };

function shareHref(name: string): string {
  const url = typeof window === 'undefined' ? '' : window.location.href;
  return `https://wa.me/?text=${encodeURIComponent(`${name} on VeganWay DXB ${url}`)}`;
}

/** Save uses the Listings bookmark API and its cached listing detail. */
function SaveButton({ slug, saved }: { slug: string; saved: boolean }) {
  const setSaved = useSetSaved(slug);
  const toast = useToast();
  const requireAccount = useRequireAccount();
  return (
    <IconButton
      label={saved ? 'Saved' : 'Save'}
      aria-pressed={saved}
      onClick={() => requireAccount(() => {
        const next = !saved;
        setSaved.mutate(next, {
          onSuccess: () => toast.show({ message: next ? 'Saved. Find it in Me.' : 'Removed from saved.', onUndo: () => setSaved.mutate(!next) }),
          onError: (err) => toast.show({ message: errorMessage(err) }),
        });
      })}
    >
      <Bookmark size={22} aria-hidden="true" className={saved ? 'fill-current text-brand' : undefined} />
    </IconButton>
  );
}

export function ServiceProfile() {
  const { slug } = useParams();
  const { data: s, isPending, error } = useService(slug);
  // The Listings detail carries the opinion counts, my opinion and saved state that OpinionBar and Save update.
  const { data: listing } = useListing(slug);
  const requireAccount = useRequireAccount();
  const [sheet, setSheet] = useState<'claim' | 'edit' | 'report' | null>(null);

  if (isPending) {
    return (
      <>
        <TopBar back="/explore?kind=service" />
        <ListSkeleton count={3} />
      </>
    );
  }
  if (!s) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <>
        <TopBar back="/explore?kind=service" />
        <EmptyState
          icon={SearchX}
          line={notFound ? 'This service is not here any more.' : 'Could not load this page. Please try again.'}
          action={{ label: 'Explore services', to: '/explore' }}
        />
      </>
    );
  }

  const links = contactLinks(s.contact);
  const primary = links.find((l) => l.kind === 'whatsapp');
  const secondary = links.filter((l) => l.kind !== 'whatsapp');
  const isOwner = s.viewer?.isOwner ?? false;

  return (
    <>
      <TopBar
        back="/explore?kind=service"
        actions={(
          <>
            <a href={shareHref(s.name)} target="_blank" rel={LINK_REL} aria-label="Share on WhatsApp" title="Share on WhatsApp" className="inline-flex size-11 items-center justify-center rounded-full hover:bg-surface-2">
              <Share2 size={22} aria-hidden="true" />
            </a>
            {listing && <SaveButton slug={listing.slug} saved={listing.saved} />}
            <IconButton label="Report" onClick={() => requireAccount(() => setSheet('report'))}>
              <Flag size={22} aria-hidden="true" />
            </IconButton>
          </>
        )}
      />

      <article className="flex flex-col gap-6 pb-6">
        <header className="flex flex-col gap-4">
          <div data-testid="listing-photo">
            <HeroMedia name={s.name} category={s.category} kind="service" photoUrl={s.photoUrl} className="-mt-2" />
            {s.photoUrl && s.photoId && <div className="flex justify-end"><ReportButton targetType="photo" targetId={s.photoId} variant="text" /></div>}
          </div>
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-extrabold break-words">{s.name}</h1>
            <div className="flex flex-wrap items-center gap-1.5">
              <VeganStatusTag status={s.veganStatus} />
              {s.category && <Tag tone="plain">{s.category}</Tag>}
              {s.ownerRun && <OwnerBadge />}
            </div>
            {s.area && (
              <p className="flex items-center gap-1.5 text-base text-muted">
                <MapPin size={18} aria-hidden="true" />
                {areaLabel(s.area)}
              </p>
            )}
            <OpinionSummary count={listing?.recommendCount ?? s.counts.recommend} />
          </div>
        </header>

        <section aria-labelledby="offer-h" className="flex flex-col gap-2">
          <h2 id="offer-h" className="text-lg font-extrabold">What they offer</h2>
          <p className="text-base whitespace-pre-line break-words">{s.summary || 'No description yet.'}</p>
        </section>

        {links.length > 0 && (
          <section aria-labelledby="contact-h" className="flex flex-col gap-2">
            <h2 id="contact-h" className="sr-only">Contact</h2>
            {/* WhatsApp is the one primary contact; Instagram and Website are quiet outline chips in one row. */}
            {primary && (
              <a href={primary.href} target="_blank" rel={LINK_REL} data-testid="contact-whatsapp" className={buttonClass('primary', 'lg', true)}>
                <MessageCircle size={18} aria-hidden="true" /> {primary.label}
              </a>
            )}
            {secondary.length > 0 && (
              <div className="flex gap-2">
                {secondary.map((l) => {
                  const Icon = ICONS[l.kind];
                  return (
                    <a
                      key={l.kind}
                      href={l.href}
                      target="_blank"
                      rel={LINK_REL}
                      data-testid={`contact-${l.kind}`}
                      className="inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-bold text-ink hover:bg-surface-2"
                    >
                      <Icon size={16} aria-hidden="true" className="shrink-0 text-brand" />
                      <span className="truncate">{l.label}</span>
                    </a>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {isOwner && (
          <Button variant="secondary" block icon={<Pencil size={18} aria-hidden="true" />} onClick={() => setSheet('edit')}>Edit your page</Button>
        )}

        <section aria-labelledby="recs-h" className="flex flex-col gap-3">
          <h2 id="recs-h" className="text-lg font-extrabold">Recommendations</h2>
          <Recommendations slug={s.slug} creator={listing?.createdBy.pseudonym} />
        </section>

        <Replies targetType="listing" targetId={s.id} composer="inline" />
        <LinkedTopics listingId={s.id} listingName={s.name} listingSlug={s.slug} listingKind={s.kind} />

        {!s.ownerRun && (
          <Card className="flex items-center gap-3">
            <Store size={24} aria-hidden="true" className="shrink-0 text-brand" />
            <p className="flex-1 text-sm">Do you run {s.name}?</p>
            <Button size="md" variant="secondary" onClick={() => requireAccount(() => setSheet('claim'))}>This is my business</Button>
          </Card>
        )}
      </article>

      {listing && <ListingActionBar listing={listing} name={s.name} />}
      {!s.ownerRun && <ClaimSheet open={sheet === 'claim'} onClose={() => setSheet(null)} listingId={s.id} slug={s.slug} name={s.name} claim={s.viewer?.claim ?? null} />}
      {isOwner && <EditServiceSheet open={sheet === 'edit'} onClose={() => setSheet(null)} service={s} />}
      <ReportSheet open={sheet === 'report'} onClose={() => setSheet(null)} targetType="listing" targetId={s.id} what="this service" />
    </>
  );
}
