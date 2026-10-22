// One discussion or poll: title, body, author, linked listings, poll, replies and a sticky composer.
import type { LinkedListing } from '../../shared/types/talk';
import { useCategoryAccent } from '../features/talk/categoryAccent';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Flag, MessagesSquare, Pin, Share2 } from 'lucide-react';
import { ApiError, errorMessage } from '../api/client';
import { useUser } from '../api/session';
import { Avatar, EmptyState, IconButton, Skeleton, Tag, TopBar, useToast } from '../ui';
import { useRequireAccount } from '../features/auth/Gate';
import { usePin, useTopic, useTopicUpvote } from '../features/talk/api';
import { age, listingHref, whatsappShare } from '../features/talk/format';
import { PollBlock } from '../features/talk/PollBlock';
import { Replies } from '../features/talk/Replies';
import { ReportSheet, type ReportTarget } from '../features/talk/ReportSheet';
import { UpvoteButton } from '../features/talk/UpvoteButton';


function LinkedListingChip({ listing: l }: { listing: LinkedListing }) {
  const category = useCategoryAccent(undefined, l.slug);
  return (
    <li data-category={category} className="linked-category min-w-0 max-w-full">
      <Link to={listingHref(l)} className="inline-flex h-11 max-w-full items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-semibold hover:bg-surface-2">
        <span className="min-w-0 truncate" title={l.name}>{l.name}</span>
        <span className="shrink-0 text-xs font-bold text-muted">{l.kind === 'place' ? 'Place' : l.kind === 'product' ? 'Product' : 'Service'}</span>
      </Link>
    </li>
  );
}

export function Topic() {
  const { id } = useParams();
  const topic = useTopic(id);
  const user = useUser();
  const upvote = useTopicUpvote(id ?? '');
  const pin = usePin(id ?? '');
  const toast = useToast();
  const requireAccount = useRequireAccount();
  const [report, setReport] = useState<ReportTarget | null>(null);

  if (topic.isPending) {
    return (
      <>
        <TopBar back="/talk" />
        <div role="status" aria-label="Loading discussion" className="flex flex-col gap-3 pt-2">
          <Skeleton className="h-7 w-4/5" />
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-24 w-full rounded-card" />
        </div>
      </>
    );
  }
  if (topic.isError || !topic.data) {
    const missing = topic.error instanceof ApiError && topic.error.status === 404;
    return (
      <>
        <TopBar title="Discussion" back="/talk" />
        <EmptyState
          icon={MessagesSquare}
          line={missing ? 'This discussion is not here. It may have been removed.' : errorMessage(topic.error)}
          action={missing ? { label: 'Back to Talk', to: '/talk' } : { label: 'Try again', onClick: () => void topic.refetch() }}
        />
      </>
    );
  }

  const t = topic.data;
  const isAdmin = user?.role === 'admin';
  const path = `/talk/${t.id}`;

  return (
    <>
      <TopBar
        back="/talk"
        title={t.kind === 'poll' ? 'Poll' : 'Discussion'}
        actions={(
          <>
            {isAdmin && (
              // Admin only: a labelled pill, so "Unpin" never reads as a disabled pin.
              <button
                type="button"
                aria-label={t.pinned ? 'Unpin' : 'Pin to the top'}
                onClick={() => pin.mutate(!t.pinned, {
                  onSuccess: (res) => toast.show({ success: true, message: res.pinned ? 'Pinned' : 'Unpinned' }),
                  onError: (err) => toast.show({ message: errorMessage(err) }),
                })}
                className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-bold text-ink transition hover:bg-surface-2"
              >
                <Pin size={18} aria-hidden="true" />
                {t.pinned ? 'Unpin' : 'Pin'}
              </button>
            )}
            <a
              href={whatsappShare(t.title, path)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Share on WhatsApp"
              title="Share on WhatsApp"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink transition hover:bg-surface-2"
            >
              <Share2 size={20} aria-hidden="true" />
            </a>
            {!t.mine && (
              <IconButton label="Report" onClick={() => requireAccount(() => setReport({ type: 'topic', id: t.id }))}>
                <Flag size={20} aria-hidden="true" />
              </IconButton>
            )}
          </>
        )}
      />

      <article className="flex flex-col gap-4 pb-6">
        {(t.pinned || t.hidden) && (
          <div className="flex flex-wrap gap-2">
            {t.pinned && <Tag tone="saffron"><Pin size={12} aria-hidden="true" />Pinned</Tag>}
            {t.hidden && <Tag tone="plain">Hidden</Tag>}
          </div>
        )}
        <h1 className="text-2xl font-extrabold break-words">{t.title}</h1>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <Avatar name={t.author.name} size="sm" />
            <p className="text-sm text-muted">
              <span className="font-bold text-ink">{t.author.name}</span> · <time dateTime={t.createdAt}>{age(t.createdAt)}</time>
            </p>
          </div>
          {t.tags.length > 0 && (
            // Quiet tags under the meta line: a small pill inside a 44 px tall link.
            <ul className="-my-1 flex flex-wrap gap-x-1" aria-label="Tags">
              {t.tags.map((tag) => (
                <li key={tag}>
                  <Link to={`/talk?tag=${encodeURIComponent(tag)}`} className="group inline-flex h-11 items-center">
                    <span className="rounded-full bg-surface-2 px-3 py-0.5 text-xs font-bold text-muted group-hover:text-ink">#{tag}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        {t.body && <p className="text-base break-words whitespace-pre-line">{t.body}</p>}

        {t.listings.length > 0 && (
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-bold text-muted">Linked</h2>
            <ul className="flex flex-wrap gap-2">
              {t.listings.map((l) => (
                <LinkedListingChip key={l.id} listing={l} />
              ))}
            </ul>
          </div>
        )}

        {t.poll && <PollBlock topicId={t.id} poll={t.poll} />}

        <div className="-ml-3 flex items-center">
          <UpvoteButton count={t.upvotes} upvoted={t.upvoted} onToggle={() => requireAccount(() => upvote.mutate())} />
        </div>
      </article>

      <Replies targetType="topic" targetId={t.id} />
      <ReportSheet target={report} onClose={() => setReport(null)} />
    </>
  );
}
