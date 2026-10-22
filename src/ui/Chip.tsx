import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  icon?: ReactNode;
}

/** A toggle chip. 44 px tall so it meets the touch target. Use inside ChipRow. */
export function Chip({ selected = false, icon, className, children, type = 'button', ...rest }: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cx(
        'chip inline-flex h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold whitespace-nowrap transition',
        selected ? 'border-ink bg-ink text-bg' : 'border-line bg-surface text-ink hover:bg-surface-2',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

/** A static label chip, e.g. a vegan status. Not interactive. */
export function Tag({ tone = 'soft', children, className }: { tone?: 'soft' | 'saffron' | 'plain'; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-3 py-0.5 text-xs font-bold',
        tone === 'soft' && 'bg-surface-2 text-ink',
        tone === 'saffron' && 'bg-saffron text-on-saffron',
        tone === 'plain' && 'bg-surface-2 text-muted',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** One row of chips that scrolls sideways inside its own box, edge to edge on phones. */
export function ChipRow({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="group" aria-label={label} className={cx('no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-1', className)}>
      {children}
    </div>
  );
}
