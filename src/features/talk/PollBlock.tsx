// A poll: tap an option to vote; after voting (or after close) animated result bars.
import { m, useReducedMotion } from 'motion/react';
import { Check } from 'lucide-react';
import type { Poll } from '../../../shared/types/talk';
import { errorMessage } from '../../api/client';
import { useToast } from '../../ui';
import { cx } from '../../lib/cx';
import { useRequireAccount } from '../auth/Gate';
import { useVote } from './api';
import { closesIn, plural } from './format';

export function PollBlock({ topicId, poll, compact = false }: { topicId: string; poll: Poll; compact?: boolean }) {
  const still = useReducedMotion();
  const vote = useVote(topicId);
  const toast = useToast();
  const requireAccount = useRequireAccount();
  const open = !poll.closed;
  const showResults = poll.resultsVisible;
  const total = poll.options.reduce((n, o) => n + (o.votes ?? 0), 0) || (poll.totalVotes ?? 0);

  const choose = (optionId: string) => {
    if (!open || vote.isPending || optionId === poll.myVote) return;
    requireAccount(() => {
      const previous = poll.myVote;
      vote.mutate(optionId, {
        onSuccess: () => toast.show({ success: true,
          message: previous ? 'Vote changed' : 'Vote saved',
          onUndo: () => vote.mutate(previous, { onError: (err) => toast.show({ message: errorMessage(err) }) }),
        }),
        onError: (err) => toast.show({ message: errorMessage(err) }),
      });
    });
  };

  return (
    <div className={cx('flex flex-col', compact ? 'gap-2' : 'gap-2')}>
      <ul className={cx('flex flex-col', compact ? 'gap-2' : 'gap-2')} aria-label="Poll options">
        {poll.options.map((o) => {
          const mine = poll.myVote === o.id;
          const pct = showResults && total ? Math.round(((o.votes ?? 0) / total) * 100) : 0;
          return (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => choose(o.id)}
                disabled={!open}
                aria-pressed={mine}
                aria-label={showResults ? `${o.label}, ${pct} percent${mine ? ', your vote' : ''}` : `Vote for ${o.label}`}
                className={cx(
                  'relative flex w-full items-center gap-2 overflow-hidden rounded-input border text-left transition',
                  compact ? 'min-h-11 px-3 text-sm' : 'min-h-12 px-4 text-base',
                  mine ? 'border-ink' : 'border-line',
                  open && !mine && 'hover:border-ink active:scale-[0.99] active:border-ink active:bg-cool-soft',
                  !open && 'disabled:opacity-100',
                  showResults ? 'bg-surface' : 'cursor-pointer bg-surface font-semibold shadow-1',
                )}
              >
                {!showResults && open && (
                  // A radio circle, so an unvoted option reads as something to tap.
                  <span aria-hidden="true" className="relative size-5 shrink-0 rounded-full border-2 border-muted/60 bg-surface" />
                )}
                {showResults && (
                  <m.span
                    aria-hidden="true"
                    className={cx('absolute inset-y-0 left-0 w-full origin-left', mine ? 'bg-cool-soft' : 'bg-surface-2')}
                    initial={still ? false : { scaleX: 0 }}
                    animate={{ scaleX: pct / 100 }}
                    transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
                  />
                )}
                <span className="relative min-w-0 flex-1 py-2 break-words">{o.label}</span>
                {mine && <Check size={18} className="relative shrink-0 text-cool" aria-hidden="true" />}
                {showResults && <span className="relative shrink-0 font-extrabold tabular-nums">{pct}%</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="flex flex-wrap gap-x-2 text-xs text-muted">
        {poll.totalVotes !== undefined && (
          <>
            <span>{poll.totalVotes > 0 ? plural(poll.totalVotes, 'vote', 'votes') : 'No votes yet'}</span>
            <span aria-hidden="true">·</span>
          </>
        )}
        <span>{closesIn(poll.closesAt, poll.closed)}</span>
        {poll.myVote && (
          <>
            <span aria-hidden="true">·</span>
            <span className="font-bold text-cool">You voted</span>
          </>
        )}
      </p>
      {!compact && open && poll.myVote && <p className="text-xs text-muted">Tap another option to change your vote.</p>}
      {!compact && open && !showResults && <p className="text-xs text-muted">Results show after you vote.</p>}
    </div>
  );
}
