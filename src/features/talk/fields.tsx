// Inputs shared by the discussion and poll forms: tags and linked listings.
import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { normalizeTag, TAG_MAX, TOPIC_LISTINGS_MAX, TOPIC_TAGS_MAX, type LinkedListing, type ListingKind } from '../../../shared/types/talk';
import { api, ApiError } from '../../api/client';
import { Chip, ChipRow, INPUT_FOCUS } from '../../ui';
import { cx } from '../../lib/cx';
import { useTags } from './api';

const INPUT = 'h-12 w-full rounded-input border bg-surface px-4 text-base text-ink placeholder:text-muted ' + INPUT_FOCUS;

/** Remove chip for a chosen tag or listing. */
function Picked({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <li className="inline-flex h-11 min-w-0 max-w-full items-center gap-1 rounded-full bg-brand-soft pr-0 pl-4 text-sm font-bold text-brand">
      <span className="min-w-0 max-w-[16rem] truncate" title={label}>{label}</span>
      <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} className="inline-flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-surface">
        <X size={16} aria-hidden="true" />
      </button>
    </li>
  );
}

export function TagInput({ value, onChange, error }: { value: string[]; onChange: (tags: string[]) => void; error?: string | null }) {
  const id = useId();
  const [text, setText] = useState('');
  const popular = useTags();
  const full = value.length >= TOPIC_TAGS_MAX;

  const add = (raw: string) => {
    const tag = normalizeTag(raw.replace(/^#/, '')).slice(0, TAG_MAX);
    if (!tag || value.includes(tag) || full) return;
    onChange([...value, tag]);
    setText('');
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(text);
    } else if (e.key === 'Backspace' && !text && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  const suggestions = (popular.data ?? []).filter((t) => !value.includes(t)).slice(0, 8);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-bold text-ink">Tags <span className="font-semibold text-muted">(optional, up to {TOPIC_TAGS_MAX})</span></label>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Chosen tags">
          {value.map((t) => <Picked key={t} label={`#${t}`} onRemove={() => onChange(value.filter((x) => x !== t))} />)}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => text.trim() && add(text)}
          disabled={full}
          maxLength={TAG_MAX + 1}
          placeholder={full ? 'Tag limit reached' : 'e.g. breakfast'}
          enterKeyHint="done"
          aria-invalid={Boolean(error) || undefined}
          className={cx(INPUT, error ? 'border-danger' : 'border-line')}
        />
        <button
          type="button"
          onClick={() => add(text)}
          disabled={!text.trim() || full}
          aria-label="Add tag"
          className="inline-flex size-12 shrink-0 items-center justify-center rounded-input border border-line bg-surface text-brand disabled:opacity-40"
        >
          <Plus size={20} aria-hidden="true" />
        </button>
      </div>
      {suggestions.length > 0 && !full && (
        <ChipRow label="Popular tags">
          {suggestions.map((t) => <Chip key={t} onClick={() => add(t)}>#{t}</Chip>)}
        </ChipRow>
      )}
      {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
    </div>
  );
}

interface Suggestion {
  id: string;
  name: string;
  slug: string;
  kind: ListingKind;
  area?: string | null;
}

/** GET /api/listings/suggest belongs to the listings slice. Until it ships, a 404 means no matches. */
async function suggest(q: string): Promise<Suggestion[]> {
  try {
    const res = await api.get<unknown>(`/api/listings/suggest?q=${encodeURIComponent(q)}`);
    const obj = res as { items?: unknown; listings?: unknown; results?: unknown } | null;
    const list = Array.isArray(res) ? res : obj?.items ?? obj?.listings ?? obj?.results ?? [];
    if (!Array.isArray(list)) return [];
    return list.filter((x): x is Suggestion => Boolean(x && typeof x.id === 'string' && typeof x.name === 'string'))
      .map((x) => ({ id: x.id, name: x.name, slug: typeof x.slug === 'string' ? x.slug : '', kind: x.kind ?? 'place', area: x.area ?? null }));
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) return [];
    throw err;
  }
}

const KIND_LABEL: Record<ListingKind, string> = { place: 'Place', product: 'Product', service: 'Service' };

export function ListingPicker({ value, onChange, error }: { value: LinkedListing[]; onChange: (v: LinkedListing[]) => void; error?: string | null }) {
  const id = useId();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);
  const results = useQuery({ queryKey: ['listings', 'suggest', q], queryFn: () => suggest(q), enabled: q.length >= 2, staleTime: 30_000 });
  const full = value.length >= TOPIC_LISTINGS_MAX;
  const options = (results.data ?? []).filter((s) => !value.some((v) => v.id === s.id));

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-bold text-ink">
        Link places, products or services <span className="font-semibold text-muted">(optional, up to {TOPIC_LISTINGS_MAX})</span>
      </label>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Linked">
          {value.map((l) => <Picked key={l.id} label={l.name} onRemove={() => onChange(value.filter((x) => x.id !== l.id))} />)}
        </ul>
      )}
      {!full && (
        <input
          id={id}
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a name"
          autoComplete="off"
          aria-invalid={Boolean(error) || undefined}
          className={cx(INPUT, error ? 'border-danger' : 'border-line')}
        />
      )}
      {!full && q.length >= 2 && results.isSuccess && (
        options.length > 0 ? (
          <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-input border border-line bg-surface" aria-label="Matches">
            {options.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange([...value, { id: s.id, name: s.name, slug: s.slug, kind: s.kind }]);
                    setText('');
                    setQ('');
                  }}
                  className="flex min-h-12 w-full items-center gap-2 px-4 py-2 text-left hover:bg-surface-2"
                >
                  <span className="min-w-0 flex-1 truncate font-semibold">{s.name}</span>
                  <span className="shrink-0 text-xs font-bold text-muted">{KIND_LABEL[s.kind] ?? ''}{s.area ? ` · ${s.area}` : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">No matches. Add it first, then link it.</p>
      )}
      {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
    </div>
  );
}

/** Split an API error into a field error (by the first path segment) or a form error. */
export function fieldError(err: unknown, field: string): string | null {
  return err instanceof ApiError && err.field && err.field.split('.')[0] === field ? err.message : null;
}

export function formError(err: unknown, fields: string[]): string | null {
  if (!err) return null;
  if (err instanceof ApiError && err.field && fields.includes(err.field.split('.')[0])) return null;
  return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
}
