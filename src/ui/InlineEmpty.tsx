import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router';

/**
 * The one empty state inside a screen section (detail pages, Me): a quiet icon line in muted text,
 * with an optional text link at the end. No box, no dashed border, no button. Full screen empty
 * states (a whole list with nothing in it) use EmptyState instead.
 */
export function InlineEmpty({ icon: Icon, line, action }: { icon: LucideIcon; line: string; action?: { label: string; to: string } }) {
  return (
    <div className="flex min-h-11 items-center gap-2 text-sm text-muted">
      <Icon size={18} aria-hidden="true" className="shrink-0" />
      <p className="min-w-0 flex-1">{line}</p>
      {action && (
        <Link to={action.to} className="-mr-2 inline-flex h-11 shrink-0 items-center rounded-input px-2 font-bold text-brand hover:bg-brand-soft">
          {action.label}
        </Link>
      )}
    </div>
  );
}
