// Up to three discussions that link a listing, for listing and service pages:
// <LinkedTopics listingId={id} listingName={name} listingSlug={slug} listingKind={kind} />
import { Link } from 'react-router';
import { ChevronRight, MessageCircle, MessagesSquare } from 'lucide-react';
import type { ListingKind } from '../../../shared/types/talk';
import { ButtonLink, InlineEmpty, Skeleton } from '../../ui';
import { useLinkedTopics } from './api';
import { plural } from './format';

export interface LinkedTopicsProps {
  listingId: string;
  /** Name, slug and kind let the new discussion form show the link without a lookup. */
  listingName?: string;
  listingSlug?: string;
  listingKind?: ListingKind;
}

export function startDiscussionPath({ listingId, listingName, listingSlug, listingKind }: LinkedTopicsProps): string {
  const qs = new URLSearchParams({ listing: listingId });
  if (listingName) qs.set('name', listingName);
  if (listingSlug) qs.set('slug', listingSlug);
  if (listingKind) qs.set('kind', listingKind);
  return `/add/discussion?${qs}`;
}

export function LinkedTopics(props: LinkedTopicsProps) {
  const { data, isPending } = useLinkedTopics(props.listingId);
  return (
    <section aria-labelledby={`linked-${props.listingId}`} className="flex flex-col gap-3">
      <h2 id={`linked-${props.listingId}`} className="text-lg font-extrabold">Discussions</h2>
      {isPending && <Skeleton className="h-16 w-full rounded-card" />}
      {data && data.items.length === 0 && (
        <InlineEmpty icon={MessagesSquare} line="No discussions about this yet." />
      )}
      {data && data.items.length > 0 && (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {data.items.map((t) => (
            <li key={t.id}>
              <Link to={`/talk/${t.id}`} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-surface-2">
                <span className="min-w-0 flex-1">
                  <span className="block font-bold break-words">{t.title}</span>
                  <span className="flex items-center gap-1 text-xs text-muted">
                    <MessageCircle size={14} aria-hidden="true" /> {plural(t.replyCount, 'reply', 'replies')}
                    {t.kind === 'poll' && ' · Poll'}
                  </span>
                </span>
                <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {data && data.total > data.items.length && (
        <p className="text-xs text-muted">{plural(data.total, 'discussion', 'discussions')} in total. Search Talk to see them all.</p>
      )}
      <ButtonLink to={startDiscussionPath(props)} variant="secondary" size="md" block>Start a discussion about this</ButtonLink>
    </section>
  );
}
