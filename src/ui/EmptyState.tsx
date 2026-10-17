import type { LucideIcon } from 'lucide-react';
import { Button, ButtonLink } from './Button';

export interface EmptyStateProps {
  icon: LucideIcon;
  /** One line, e.g. "No places yet. Add the first one." */
  line: string;
  action?: { label: string; to: string } | { label: string; onClick: () => void };
}

/** One icon, one line, one button. */
export function EmptyState({ icon: Icon, line, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-12 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-brand-soft text-brand">
        <Icon size={28} aria-hidden="true" />
      </div>
      <p className="max-w-[28ch] text-base font-semibold text-ink">{line}</p>
      {action && ('to' in action
        ? <ButtonLink to={action.to} size="md">{action.label}</ButtonLink>
        : <Button size="md" onClick={action.onClick}>{action.label}</Button>)}
    </div>
  );
}
