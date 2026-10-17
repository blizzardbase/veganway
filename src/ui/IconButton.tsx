import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** Required: an icon alone has no name for screen readers. */
  label: string;
  children: ReactNode;
  tone?: 'plain' | 'soft';
}

/** A 44 by 44 round button holding one icon. */
export function IconButton({ label, children, tone = 'plain', className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink transition',
        tone === 'soft' ? 'bg-surface-2 hover:bg-line' : 'hover:bg-surface-2',
        'disabled:opacity-50',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
