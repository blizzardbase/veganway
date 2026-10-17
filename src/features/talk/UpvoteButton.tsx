import { ArrowBigUp } from 'lucide-react';
import { cx } from '../../lib/cx';

/**
 * A 44 px upvote toggle with its count. At 0 it says "Upvote" instead of a 0 (a row of zeros reads as
 * empty, and a lone arrow reads as nothing). iconOnly keeps the bare arrow for a card's corner.
 */
export function UpvoteButton({ count, upvoted, onToggle, label = 'Upvote', iconOnly = false }: {
  count: number; upvoted: boolean; onToggle: () => void; label?: string; iconOnly?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={upvoted}
      aria-label={`${label}, ${count} ${count === 1 ? 'upvote' : 'upvotes'}`}
      className={cx(
        'inline-flex h-11 min-w-11 items-center justify-center gap-1 rounded-full px-3 text-sm font-bold transition active:scale-95',
        upvoted ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-surface-2 hover:text-ink',
      )}
    >
      <ArrowBigUp size={22} strokeWidth={upvoted ? 2.4 : 1.9} fill={upvoted ? 'currentColor' : 'none'} aria-hidden="true" />
      {count > 0 ? <span className="tabular-nums">{count}</span> : !iconOnly && <span>Upvote</span>}
    </button>
  );
}
