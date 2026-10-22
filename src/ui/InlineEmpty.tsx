import { BotanicalEmptyArt } from './BotanicalEmptyArt';
import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router';

/**
 * The one empty state inside a screen section (detail pages, Me): a quiet icon line in muted text,
 * with an optional text link at the end. No box, no dashed border, no button. Full screen empty
 * states (a whole list with nothing in it) use EmptyState instead.
 */
export function InlineEmpty({ icon: Icon, line, action, artwork }: { artwork?: 'saved' | 'posts'; icon: LucideIcon; line: string; action?: { label: string; to: string } }) {
  return (
    <div className="flex min-h-11 items-center gap-2 text-sm text-muted">
      {artwork ? <BotanicalEmptyArt kind={artwork} /> : <span className="inline-empty-art relative flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink">
        <svg aria-hidden="true" viewBox="0 0 64 64" className="absolute -inset-2 size-[60px]" fill="none"><path d="M8 36 Q2 17 17 18 Q22 28 8 36 M48 49 Q47 34 60 35 Q62 46 48 49" fill="currentColor" opacity=".25" /><path d="M8 44 Q2 29 11 16 M50 54 Q62 46 58 32" stroke="currentColor" opacity=".3" /></svg>
        <Icon size={20} aria-hidden="true" className="relative" />
      </span>}
      <p className="min-w-0 flex-1">{line}</p>
      {action && (
        <Link to={action.to} className="-mr-2 inline-flex h-11 shrink-0 items-center rounded-input px-2 font-bold text-ink hover:bg-surface-2">
          {action.label}
        </Link>
      )}
    </div>
  );
}
