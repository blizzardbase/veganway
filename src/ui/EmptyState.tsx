import { BotanicalEmptyArt } from './BotanicalEmptyArt';
import type { LucideIcon } from 'lucide-react';
import { Button, ButtonLink } from './Button';

export interface EmptyStateProps {
  artwork?: 'search';
  icon: LucideIcon;
  /** One line, e.g. "No places yet. Add the first one." */
  line: string;
  action?: { label: string; to: string } | { label: string; onClick: () => void };
}

/** One icon, one line, one button. */
export function EmptyState({ icon: Icon, line, action, artwork }: EmptyStateProps) {
  return (
    <div className="empty-state flex flex-col items-center gap-4 px-6 py-12 text-center">
      {artwork ? <BotanicalEmptyArt kind={artwork} /> : <div className="empty-mark relative flex size-16 items-center justify-center rounded-full bg-surface-2 text-ink">
        <svg aria-hidden="true" viewBox="0 0 112 96" className="pointer-events-none absolute -inset-x-6 -inset-y-4 h-24 w-28 overflow-visible" fill="none">
          <ellipse cx="56" cy="49" rx="48" ry="35" stroke="currentColor" strokeOpacity="0.18" strokeDasharray="3 7" />
          <path d="M10 27 Q8 10 24 14 Q24 27 10 27Z" fill="currentColor" opacity="0.3" />
          <path d="M94 73 Q95 59 106 63 Q108 75 94 73Z" fill="currentColor" opacity="0.3" />
          <circle cx="93" cy="18" r="4" className="fill-saffron" />
          <circle cx="22" cy="79" r="3" className="fill-saffron" />
        </svg>
        <Icon size={28} aria-hidden="true" />
      </div>}
      <p className="max-w-[28ch] text-base font-semibold text-ink">{line}</p>
      {action && ('to' in action
        ? <ButtonLink to={action.to} size="md">{action.label}</ButtonLink>
        : <Button size="md" onClick={action.onClick}>{action.label}</Button>)}
    </div>
  );
}
