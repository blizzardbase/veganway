import type { HTMLAttributes } from 'react';
import { cx } from '../lib/cx';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds hover and press feedback for a card that is a link. */
  interactive?: boolean;
  padded?: boolean;
}

export function Card({ interactive, padded = true, className, ...rest }: CardProps) {
  return (
    <div
      className={cx(
        'rounded-card border border-line bg-surface shadow-1',
        padded && 'p-4',
        interactive && 'transition hover:shadow-2 active:scale-[0.99]',
        className,
      )}
      {...rest}
    />
  );
}
