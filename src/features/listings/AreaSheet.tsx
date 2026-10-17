// The area picker: a sheet with a search box over every Dubai area. Explore filters with it and the
// Add place form picks with it, so both read the same.
import { useState } from 'react';
import { Search } from 'lucide-react';
import { Chip, INPUT_FOCUS, Sheet } from '../../ui';
import { areaLabel, DUBAI_AREAS } from '../../../shared/types/listings';

/** The six areas most places are in, as quick chips on the Add place form. Value, then short label. */
export const POPULAR_AREAS: { value: (typeof DUBAI_AREAS)[number]; label: string }[] = [
  // Ordered so the six and "All areas" pack into two rows on a 390 px phone.
  { value: 'Downtown Dubai', label: 'Downtown' },
  { value: 'JLT', label: 'JLT' },
  { value: 'Dubai Marina', label: 'Marina' },
  { value: 'Al Quoz', label: 'Al Quoz' },
  { value: 'Business Bay', label: 'Business Bay' },
  { value: 'Jumeirah', label: 'Jumeirah' },
];

export function AreaSheet({ open, onClose, value, onPick, options = DUBAI_AREAS, allowAny = false, title = 'Area' }: {
  open: boolean;
  onClose: () => void;
  value: string | undefined | null;
  onPick: (area: string | null) => void;
  options?: readonly string[];
  /** Explore offers "Any" to clear the filter; a form does not. */
  allowAny?: boolean;
  title?: string;
}) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = needle ? options.filter((o) => areaLabel(o).toLowerCase().includes(needle)) : options;
  const pick = (area: string | null) => {
    setQ('');
    onPick(area);
  };
  return (
    <Sheet open={open} onClose={() => { setQ(''); onClose(); }} title={title}>
      <div className="flex flex-col gap-3 pb-2">
        <div className="relative">
          <Search size={18} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
          <input
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            aria-label="Search areas"
            placeholder="Search areas"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className={`h-11 w-full rounded-full border border-line bg-surface pr-4 pl-10 text-base text-ink placeholder:text-muted ${INPUT_FOCUS}`}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {allowAny && !needle && <Chip selected={!value} onClick={() => pick(null)}>Any</Chip>}
          {shown.map((o) => (
            <Chip key={o} selected={value === o} onClick={() => pick(o)}>{areaLabel(o)}</Chip>
          ))}
          {shown.length === 0 && <p className="px-1 py-2 text-sm text-muted">No area matches “{q.trim()}”.</p>}
        </div>
      </div>
    </Sheet>
  );
}
