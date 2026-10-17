import { Link } from 'react-router';
import { Search } from 'lucide-react';
import { cx } from '../lib/cx';

/** The 48 px search pill on Home and Explore. A tap opens Search. Wrap it in a sticky container. */
export function SearchPill({ placeholder = 'Search places, products and talk', className }: { placeholder?: string; className?: string }) {
  return (
    <Link
      to="/search"
      className={cx(
        'flex h-12 w-full items-center gap-3 rounded-full border border-line bg-surface px-4 text-base text-muted shadow-1 transition hover:shadow-2',
        className,
      )}
    >
      <Search size={20} aria-hidden="true" className="text-ink" />
      <span className="truncate">{placeholder}</span>
    </Link>
  );
}
