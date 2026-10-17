import { cx } from '../lib/cx';

/** A grey placeholder block. Use card shaped skeletons, never a spinner, while lists load. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx('animate-pulse rounded-input bg-surface-2', className)} />;
}

/** The skeleton for one listing card row. */
export function CardSkeleton() {
  return (
    <div aria-hidden="true" className="flex gap-3 rounded-card border border-line bg-surface p-4">
      <Skeleton className="size-16 rounded-card" />
      <div className="flex flex-1 flex-col gap-2 py-1">
        <Skeleton className="h-4 w-3/5" />
        <Skeleton className="h-3 w-2/5" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  );
}

/** A list of card skeletons with a screen reader label. */
export function ListSkeleton({ count = 3, label = 'Loading' }: { count?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-3">
      {Array.from({ length: count }, (_, i) => <CardSkeleton key={i} />)}
    </div>
  );
}
