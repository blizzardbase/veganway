import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';
import { cx } from '../lib/cx';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Hide the visible title but keep it for screen readers. */
  hideTitle?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * A bottom sheet on a native <dialog> with showModal(): focus trap, inert background,
 * Escape to close and focus return come from the browser. A tap on the backdrop closes it.
 */
export function Sheet({ open, onClose, title, hideTitle, children, className }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className={cx(
        'm-0 mt-auto mx-auto max-h-[90dvh] w-full max-w-[560px] overflow-y-auto rounded-t-sheet bg-surface p-0 text-ink shadow-3',
        'open:animate-sheet-in',
        className,
      )}
    >
      <div className="px-4 pt-2 pb-[calc(16px+var(--safe-bottom))]">
        <div aria-hidden="true" className="mx-auto mb-2 h-1 w-10 rounded-full bg-line" />
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 id={titleId} className={cx('text-lg font-extrabold', hideTitle && 'sr-only')}>{title}</h2>
          <IconButton label="Close" onClick={onClose} className="ml-auto">
            <X size={22} aria-hidden="true" />
          </IconButton>
        </div>
        {children}
      </div>
    </dialog>
  );
}
