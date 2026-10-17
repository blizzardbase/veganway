// Recommend / Not for me. One tap, optimistic, with an Undo toast. Signed out visitors go to Join.
// On a listing page they live in the one sticky bar at the bottom, beside "Add yours".
import { useState } from 'react';
import { useLocation } from 'react-router';
import { useUser } from '../../api/session';
import { Plus, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useToast } from '../../ui';
import { cx } from '../../lib/cx';
import { membersRecommend } from '../../lib/counts';
import { useRequireAccount } from '../auth/Gate';
import { errorMessage } from '../../api/client';
import { useSetOpinion } from './api';
import { RecommendationSheet } from './Recommendations';
import type { ListingDetail, OpinionValue } from '../../../shared/types/listings';

type OpinionListing = Pick<ListingDetail, 'slug' | 'myOpinion' | 'recommendCount' | 'notForMeCount'>;

/** "12 members recommend", or an invitation while nobody has. Never a 0. */
export function OpinionSummary({ count, className }: { count: number; className?: string }) {
  return (
    <p data-testid="opinion-summary" className={cx('flex items-center gap-1.5 text-sm font-bold', count > 0 ? 'text-ink' : 'text-muted', className)}>
      <ThumbsUp size={16} aria-hidden="true" className="shrink-0 text-brand" />
      {count > 0 ? membersRecommend(count) : 'Be the first to recommend'}
    </p>
  );
}

function useChoose(listing: OpinionListing) {
  const setOpinion = useSetOpinion(listing.slug);
  const toast = useToast();
  const requireAccount = useRequireAccount();
  return (value: OpinionValue) => {
    requireAccount(() => {
      const prev = listing.myOpinion;
      const next = prev === value ? null : value;
      setOpinion.mutate(next, {
        onError: (err) => toast.show({ message: errorMessage(err) }),
        onSuccess: () => toast.show({
          message: next === 'recommend' ? 'You recommend this.' : next === 'not_for_me' ? 'Marked as not for you.' : 'Your vote was removed.',
          onUndo: () => setOpinion.mutate(prev),
        }),
      });
    });
  };
}

/** The sticky bottom bar of a place, product or service page. */
export function ListingActionBar({ listing, name }: { listing: OpinionListing; name: string }) {
  const choose = useChoose(listing);
  const requireAccount = useRequireAccount();
  const location = useLocation();
  const user = useUser();
  const [composing, setComposing] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const fromDuplicate = location.hash === '#recommend' && dismissed !== location.key;

  // The recommend count already shows in the page body (OpinionSummary), so the bar does not repeat it.
  const toggle = (value: OpinionValue, label: string, Icon: typeof ThumbsUp, count = 0) => {
    const on = listing.myOpinion === value;
    return (
      <button
        type="button"
        aria-pressed={on}
        onClick={() => choose(value)}
        className={cx(
          'flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-input text-xs font-bold transition active:scale-[0.97]',
          on
            ? value === 'recommend' ? 'bg-brand-soft text-brand' : 'bg-surface-2 text-ink'
            : 'text-muted hover:bg-surface-2 hover:text-ink',
        )}
      >
        <Icon size={22} strokeWidth={on ? 2.4 : 1.9} fill={on && value === 'recommend' ? 'currentColor' : 'none'} fillOpacity={0.18} aria-hidden="true" />
        <span className="truncate">
          {label}
          {count > 0 && <span className="tabular-nums"> {count}</span>}
        </span>
      </button>
    );
  };

  return (
    <>
      <div data-testid="listing-action-bar" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[var(--safe-bottom)]">
        <div role="group" aria-label="Your opinion" className="mx-auto flex h-[var(--actionbar-h)] w-full max-w-[560px] items-center gap-1 px-3">
          {toggle('recommend', 'Recommend', ThumbsUp)}
          {toggle('not_for_me', 'Not for me', ThumbsDown, listing.notForMeCount)}
          <button
            id="recommend"
            type="button"
            onClick={() => requireAccount(() => setComposing(true))}
            className="ml-1 inline-flex h-12 flex-[1.4] items-center justify-center gap-1.5 rounded-input bg-brand px-3 text-sm font-extrabold text-on-brand shadow-1 transition active:scale-[0.98]"
          >
            <Plus size={18} strokeWidth={2.6} aria-hidden="true" />
            Add yours
          </button>
        </div>
      </div>
      <RecommendationSheet slug={listing.slug} listingName={name} open={Boolean(user) && (composing || fromDuplicate)} onClose={() => { setComposing(false); setDismissed(location.key); }} />
    </>
  );
}
