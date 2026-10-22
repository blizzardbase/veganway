import { NavLink, useLocation } from 'react-router';
import { Compass, Home, MessagesSquare, Plus, UserRound, type LucideIcon } from 'lucide-react';
import { cx } from '../lib/cx';

const TABS: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/explore', label: 'Explore', icon: Compass },
  { to: '/talk', label: 'Talk', icon: MessagesSquare },
  { to: '/me', label: 'Me', icon: UserRound },
];

function Tab({ to, label, icon: Icon, end }: (typeof TABS)[number]) {
  return (
    <li className="flex-1">
      <NavLink
        to={to}
        viewTransition
        end={end}
        className={({ isActive }) => cx(
          'relative z-10 flex h-16 flex-col items-center justify-center gap-1 text-xs font-bold transition',
          isActive ? 'text-ink' : 'text-muted hover:text-ink',
        )}
      >
        {({ isActive }) => (
          <>
            <Icon size={24} strokeWidth={isActive ? 2.4 : 1.9} aria-hidden="true" />
            <span>{label}</span>
          </>
        )}
      </NavLink>
    </li>
  );
}

/** Home, Explore, Add (raised centre), Talk, Me. 64 px plus the safe area. */
export function TabBar({ onAdd }: { onAdd: () => void }) {
  const { pathname } = useLocation();
  const tab = TABS.findIndex(({ to }) => to === '/' ? pathname === '/' : pathname.startsWith(to));
  const position = tab > 1 ? tab + 1 : tab;
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur pb-[var(--safe-bottom)]">
      <ul className="relative mx-auto flex h-16 max-w-[560px] items-center px-2">
        <li aria-hidden="true" className="tab-indicator pointer-events-none absolute top-1.5 left-2 flex h-7 w-[calc((100%-16px)/5)] justify-center" style={{ transform: `translateX(${Math.max(0, position) * 100}%)`, opacity: tab < 0 ? 0 : 1 }}>
          <span className="h-full w-12 rounded-full bg-surface-2" />
        </li>
        <Tab {...TABS[0]} />
        <Tab {...TABS[1]} />
        <li className="flex flex-1 justify-center">
          <button
            type="button"
            onClick={onAdd}
            aria-label="Add"
            className="add-button -mt-6 flex size-14 items-center justify-center rounded-full bg-brand text-on-brand shadow-3 ring-4 ring-bg transition active:scale-95"
          >
            <Plus size={28} strokeWidth={2.6} aria-hidden="true" />
          </button>
        </li>
        <Tab {...TABS[2]} />
        <Tab {...TABS[3]} />
      </ul>
    </nav>
  );
}
