// A listing's recommendations (upvote sorted) and the "Add your recommendation" composer.
// Reused by the services profile: <Recommendations slug=... /> and <RecommendationComposer slug=... />.
import { useState, type FormEvent } from 'react';
import { ArrowBigUp, MessageSquareText, Tag as TagIcon } from 'lucide-react';
import { Avatar, Button, Field, InlineEmpty, Skeleton, Sheet, useToast } from '../../ui';
import { cx } from '../../lib/cx';
import { ApiError, errorMessage } from '../../api/client';
import { useRequireAccount } from '../auth/Gate';
import { flatUnique, useCreateRecommendation, useRecommendations, useToggleUpvote } from './api';
import { ReportButton } from './ReportSheet';
import { PhotoPicker } from './PhotoPicker';
import { formatDay } from './bits';
import { BODY_MAX, type PhotoResponse, type Recommendation } from '../../../shared/types/listings';

function RecommendationItem({ rec, slug, byCreator }: { rec: Recommendation; slug: string; byCreator: boolean }) {
  const upvote = useToggleUpvote(slug);
  const requireAccount = useRequireAccount();
  const toast = useToast();
  const name = rec.author.displayName || rec.author.pseudonym;
  return (
    <article className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4 pt-3">
      <header className="-mr-2 flex items-center gap-2">
        <Avatar name={name} src={rec.author.avatarUrl} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{name}</p>
          <p className="text-xs text-muted">{byCreator ? `Added this listing · ${formatDay(rec.createdAt)}` : formatDay(rec.createdAt)}</p>
        </div>
        <button
          type="button"
          aria-pressed={rec.upvotedByMe}
          aria-label={`Upvote, ${rec.upvotes} so far`}
          onClick={() => requireAccount(() => upvote.mutate({ id: rec.id, upvote: !rec.upvotedByMe }, {
            onError: (err) => toast.show({ message: errorMessage(err) }),
          }))}
          className={cx(
            'inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-full px-3 text-sm font-bold transition',
            rec.upvotedByMe ? 'bg-warm-soft text-warm' : 'text-muted hover:bg-surface-2',
          )}
        >
          <ArrowBigUp size={20} aria-hidden="true" className={rec.upvotedByMe ? 'fill-current' : undefined} />
          {rec.upvotes > 0 && <span className="tabular-nums">{rec.upvotes}</span>}
        </button>
      </header>
      {rec.body && (
        byCreator ? (
          <div className="flex flex-col gap-1 rounded-input bg-warm-soft px-3 py-2">
            <p className="text-xs font-extrabold tracking-wide text-warm uppercase">What to order</p>
            <p className="text-base break-words whitespace-pre-line">{rec.body}</p>
          </div>
        ) : <p className="text-base break-words whitespace-pre-line">{rec.body}</p>
      )}
      {rec.offer && (
        <p className="flex items-start gap-2 rounded-input bg-saffron px-3 py-2 text-sm font-semibold text-on-saffron">
          <TagIcon size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span className="break-words">
            {rec.offer}
            {rec.offerExpiresAt && <span className="font-normal"> · until {formatDay(rec.offerExpiresAt)}</span>}
          </span>
        </p>
      )}
      {rec.photoUrl && <img src={rec.photoUrl} alt="" loading="lazy" decoding="async" className="max-h-80 w-full rounded-input bg-surface-2 object-cover" />}
      <div className="-my-1 -ml-3 flex flex-wrap gap-1">
        {!rec.mine && <ReportButton targetType="recommendation" targetId={rec.id} variant="text" />}
        {rec.photoUrl && <ReportButton targetType="photo" photoUrl={rec.photoUrl} variant="text" />}
      </div>
    </article>
  );
}

/** `creator` is the pseudonym of the member who added the listing: their text is labelled What to order. */
export function Recommendations({ slug, creator }: { slug: string; creator?: string }) {
  const q = useRecommendations(slug);
  const items = flatUnique(q.data?.pages);
  if (q.isPending) return <div role="status" aria-label="Loading recommendations" className="min-h-11"><Skeleton className="h-11 w-full" /></div>;
  if (q.isError) return <p className="text-sm text-muted">{errorMessage(q.error)}</p>;
  if (items.length === 0) {
    return <InlineEmpty icon={MessageSquareText} line="No recommendations yet. Be the first to say what to order." />;
  }
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {items.map((r) => <li key={r.id}><RecommendationItem rec={r} slug={slug} byCreator={Boolean(creator) && r.author.pseudonym === creator} /></li>)}
      </ul>
      {q.hasNextPage && (
        <Button variant="secondary" block busy={q.isFetchingNextPage} busyLabel="Loading" onClick={() => void q.fetchNextPage()}>
          Load more
        </Button>
      )}
    </div>
  );
}

/** A button that opens the composer sheet. Signed out visitors go to Join first. */
export function RecommendationComposer({ slug, listingName }: { slug: string; listingName: string }) {
  const [open, setOpen] = useState(false);
  const requireAccount = useRequireAccount();
  return (
    <>
      <Button id="recommend" variant="secondary" block icon={<MessageSquareText size={18} aria-hidden="true" />} onClick={() => requireAccount(() => setOpen(true))}>
        Add your recommendation
      </Button>
      <RecommendationSheet slug={slug} listingName={listingName} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** The composer sheet itself, for a trigger elsewhere (the listing action bar). */
export function RecommendationSheet({ slug, listingName, open, onClose }: { slug: string; listingName: string; open: boolean; onClose: () => void }) {
  const [body, setBody] = useState('');
  const [photo, setPhoto] = useState<PhotoResponse | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = useCreateRecommendation(slug);
  const toast = useToast();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const text = body.trim();
    if (text.length < 3) {
      setError('Write a little more, at least 3 characters.');
      return;
    }
    setError(null);
    try {
      await create.mutateAsync({ body: text, photoId: photo?.id });
      setBody('');
      setPhoto(null);
      onClose();
      toast.show({ success: true, message: 'Thanks. Your recommendation is up.' });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorMessage(err));
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={`Recommend ${listingName}`}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4 pb-2">
        <Field
          multiline
          label="What to order, and why"
          value={body}
          maxLength={BODY_MAX}
          onChange={(e) => setBody(e.target.value)}
          error={error}
          hint="No phone numbers or email addresses, please."
        />
        <PhotoPicker value={photo} onChange={setPhoto} onBusy={setUploading} />
        <Button type="submit" block busy={create.isPending} busyLabel="Posting" disabled={uploading}>Post recommendation</Button>
      </form>
    </Sheet>
  );
}
