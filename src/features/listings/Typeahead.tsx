// Name typeahead pieces: the duplicate hint under a new listing's name, and the listing
// picker used by the Offer form. Both call GET /api/listings/suggest.
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Check, CircleAlert, Search, X } from 'lucide-react';
import { Field, IconButton } from '../../ui';
import { useSuggest } from './api';
import { listingPath, type ListingKind, type ListingSuggestion } from '../../../shared/types/listings';

export function useDebounced<T>(value: T, ms = 250): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return out;
}

function where(s: ListingSuggestion): string {
  return s.kind === 'product' ? s.stores.join(', ') : s.area ?? '';
}

/** "Already here, add your recommendation": matches for the name being typed. */
export function DuplicateHint({ name, kind }: { name: string; kind: ListingKind }) {
  const q = useDebounced(name);
  const { data } = useSuggest(q, kind);
  const matches = q.trim().length >= 2 ? data ?? [] : [];
  if (matches.length === 0) return null;
  return (
    <div className="rounded-card border border-saffron bg-surface p-3" aria-live="polite">
      <p className="flex items-center gap-2 text-sm font-bold">
        <CircleAlert size={16} aria-hidden="true" className="text-saffron" />
        Already here? Add your recommendation instead.
      </p>
      <ul className="mt-2 flex flex-col">
        {matches.map((m) => (
          <li key={m.id}>
            <Link
              to={`${listingPath(m)}#recommend`}
              className="flex min-h-11 items-center justify-between gap-2 rounded-input px-2 text-base hover:bg-surface-2"
            >
              <span className="min-w-0 truncate font-semibold">{m.name}</span>
              <span className="shrink-0 text-sm text-muted">{where(m)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Pick an existing listing by typing part of its name. */
export function ListingPicker({ value, onPick, error }: {
  value: ListingSuggestion | null;
  onPick: (s: ListingSuggestion | null) => void;
  error?: string | null;
}) {
  const [text, setText] = useState('');
  const q = useDebounced(text);
  const { data, isFetching } = useSuggest(q);
  const results = q.trim().length >= 2 ? data ?? [] : [];

  if (value) {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-bold text-ink">Where is the offer?</p>
        <div className="flex items-center gap-2 rounded-input border border-brand bg-brand-soft py-1 pr-1 pl-4">
          <Check size={18} aria-hidden="true" className="text-brand" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold">{value.name}</p>
            <p className="truncate text-sm text-muted">{where(value)}</p>
          </div>
          <IconButton label="Choose another" onClick={() => onPick(null)}>
            <X size={20} aria-hidden="true" />
          </IconButton>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Field
        label="Where is the offer?"
        placeholder="Type a place, product or service"
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoComplete="off"
        error={error}
        hint={q.trim().length >= 2 && !isFetching && results.length === 0 ? 'Nothing found. Add the place or product first.' : undefined}
      />
      {results.length > 0 && (
        <ul aria-label="Matching listings" className="flex flex-col rounded-card border border-line bg-surface p-1">
          {results.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onPick(s)}
                className="flex min-h-12 w-full items-center gap-2 rounded-input px-3 text-left hover:bg-surface-2"
              >
                <Search size={16} aria-hidden="true" className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate font-semibold">{s.name}</span>
                <span className="shrink-0 text-sm text-muted">{where(s)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
