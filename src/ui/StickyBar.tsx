import type { ReactNode } from 'react';

/** The one sticky bar at the bottom of an Add form (no tab bar there): usually the primary button. Solid, so no field shows through it. */
export function StickyBar({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[var(--safe-bottom)]">
      <div className="mx-auto flex w-full max-w-[560px] flex-col gap-1 px-4 py-3">{children}</div>
    </div>
  );
}
