import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cx } from '../lib/cx';

/**
 * Focus for every text input: a neutral border plus a visible 2 px outline in both themes. Never add
 * focus:outline-none beside it: in Tailwind v4 that sets --tw-outline-style to none, and outline-2
 * reads that variable, so the outline would never show.
 */
export const INPUT_FOCUS = 'focus:border-ink focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-0 focus-visible:outline-cool';

const CONTROL = cx(
  'w-full rounded-input border bg-surface px-4 text-base text-ink placeholder:text-muted transition',
  INPUT_FOCUS,
);

interface Common {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  /** Visually hide the label (it stays for screen readers). */
  hideLabel?: boolean;
  /** Extra classes for the input or textarea itself (className styles the wrapper). */
  inputClassName?: string;
}

export type FieldProps = Common & InputHTMLAttributes<HTMLInputElement> & { multiline?: false };
export type TextAreaFieldProps = Common & TextareaHTMLAttributes<HTMLTextAreaElement> & { multiline: true };

/** A labelled input (or textarea with multiline) with a hint and an error line. Inputs are 16 px. */
export function Field(props: FieldProps | TextAreaFieldProps) {
  const id = useId();
  const { label, hint, error, hideLabel, className, inputClassName } = props;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const border = error ? 'border-danger' : 'border-line';

  let control: ReactNode;
  if (props.multiline) {
    const { label: _l, hint: _h, error: _e, hideLabel: _hl, multiline: _m, className: _c, inputClassName: _ic, ...rest } = props;
    control = <textarea id={id} aria-invalid={Boolean(error) || undefined} aria-describedby={describedBy} className={cx(CONTROL, border, 'min-h-28 py-3', inputClassName)} {...rest} />;
  } else {
    const { label: _l, hint: _h, error: _e, hideLabel: _hl, multiline: _m, className: _c, inputClassName: _ic, ...rest } = props;
    control = <input id={id} aria-invalid={Boolean(error) || undefined} aria-describedby={describedBy} className={cx(CONTROL, border, 'h-12', inputClassName)} {...rest} />;
  }

  return (
    <div className={cx('flex flex-col gap-2', className)}>
      <label htmlFor={id} className={cx('text-sm font-bold text-ink', hideLabel && 'sr-only')}>{label}</label>
      {control}
      {hint && <p id={hintId} className="text-sm text-muted">{hint}</p>}
      {error && <p id={errorId} role="alert" className="text-sm font-semibold text-danger">{error}</p>}
    </div>
  );
}
