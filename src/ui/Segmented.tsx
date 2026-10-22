import { useRef, type KeyboardEvent } from 'react';
import type { CSSProperties } from 'react';
import { cx } from '../lib/cx';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  label: string;
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/** A segmented control (radio group). Arrow keys move between segments. */
export function Segmented<T extends string>({ label, options, value, onChange, className }: SegmentedProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={cx('segment-track relative isolate flex rounded-input bg-surface-2 p-1', className)}>
      <span aria-hidden="true" className="segment-pill" style={{ '--segments': options.length, '--selected': options.findIndex(o => o.value === value) } as CSSProperties} />
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={cx(
              'relative h-11 min-w-0 flex-1 rounded-[9px] px-3 text-sm font-bold transition',
              selected ? 'text-ink' : 'text-muted hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
