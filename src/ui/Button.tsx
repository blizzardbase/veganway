import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import { cx } from '../lib/cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'saffron';
export type ButtonSize = 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-on-brand shadow-1 hover:brightness-110 active:brightness-95',
  secondary: 'bg-surface text-ink border border-line hover:bg-surface-2',
  ghost: 'bg-transparent text-ink hover:bg-surface-2',
  danger: 'bg-transparent text-danger border border-line hover:bg-surface-2',
  saffron: 'bg-saffron text-on-saffron hover:brightness-105',
};

const SIZES: Record<ButtonSize, string> = {
  md: 'h-11 px-4 text-sm',
  lg: 'h-12 px-5 text-base',
};

/** Class names for a button look, for use on links too. */
export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'lg', block = false, extra?: string): string {
  return cx(
    'pressable inline-flex items-center justify-center gap-2 rounded-input font-bold select-none transition-[filter,background-color,transform]',
    'disabled:opacity-50 disabled:pointer-events-none aria-disabled:opacity-50 aria-disabled:pointer-events-none',
    VARIANTS[variant],
    SIZES[size],
    block && 'w-full',
    extra,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  /** Shows a busy label and disables the button. */
  busy?: boolean;
  busyLabel?: string;
  icon?: ReactNode;
}

export function Button({ variant = 'primary', size = 'lg', block, busy, busyLabel, icon, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={buttonClass(variant, size, block, className)} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {icon}
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}

export interface ButtonLinkProps extends LinkProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
}

export function ButtonLink({ variant = 'primary', size = 'lg', block, className, ...rest }: ButtonLinkProps) {
  return <Link className={buttonClass(variant, size, block, typeof className === 'string' ? className : undefined)} {...rest} />;
}
