// Search everything: places, products, services and discussions, three each, with See all.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ChevronLeft, ChefHat, Clock, MessagesSquare, Search as SearchIcon, SearchX, ShoppingBasket, Store, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { EmptyState, IconButton, INPUT_FOCUS, Monogram, Skeleton } from '../ui';
import { membersRecommend, replyCount } from '../lib/counts';
import { clearRecent, readRecent, rememberSearch, useSearch } from '../features/search/api';
import { Highlight } from '../features/search/Highlight';
import { VeganStatusTag } from '../features/listings/bits';
import { SEARCH_MAX, SEARCH_TYPES, type ListingHit, type SearchGroup, type SearchType, type TopicHit } from '../../shared/types/search';

const GROUPS: { type: SearchType; title: string; icon: LucideIcon }[] = [
  { type: 'places', title: 'Places', icon: Store },
  { type: 'products', title: 'Products', icon: ShoppingBasket },
  { type: 'services', title: 'Services', icon: ChefHat },
  { type: 'discussions', title: 'Discussions', icon: MessagesSquare },
];

const VIA: Record<ListingHit['matchedVia'], string | null> = { listing: null, recommendation: 'From a recommendation', reply: 'From a reply' };

function listingPath(h: ListingHit): string {
  return `/${h.kind === 'service' ? 'services' : h.kind === 'product' ? 'products' : 'places'}/${h.slug}`;
}

function ListingRow({ hit, q, onOpen }: { hit: ListingHit; q: string; onOpen: () => void }) {
  return (
    <li>
      <Link to={listingPath(hit)} onClick={onOpen} className="flex gap-3 rounded-card px-2 py-3 hover:bg-surface-2">
        {hit.photoUrl
          ? <img src={hit.photoUrl} alt="" loading="lazy" decoding="async" className="size-11 shrink-0 rounded-input bg-surface-2 object-cover" />
          : <Monogram name={hit.name} category={hit.category} kind={hit.kind} size="sm" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-bold"><Highlight text={hit.name} query={q} /></span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            {hit.area && <span>{hit.area}</span>}
            <VeganStatusTag status={hit.veganStatus} />
            {hit.recommendCount > 0 && <span>{membersRecommend(hit.recommendCount)}</span>}
          </span>
          {hit.snippet && (
            <span className="mt-1 line-clamp-2 block text-sm break-words">
              {VIA[hit.matchedVia] && <span className="font-bold text-muted">{VIA[hit.matchedVia]}: </span>}
              <Highlight text={hit.snippet} query={q} />
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

function TopicRow({ hit, q, onOpen }: { hit: TopicHit; q: string; onOpen: () => void }) {
  return (
    <li>
      <Link to={`/talk/${hit.id}`} onClick={onOpen} className="flex flex-col gap-1 rounded-card px-2 py-3 hover:bg-surface-2">
        <span className="text-base font-bold break-words"><Highlight text={hit.title} query={q} /></span>
        {hit.snippet && (
          <span className="line-clamp-2 text-sm break-words">
            {hit.matchedVia === 'reply' && <span className="font-bold text-muted">From a reply: </span>}
            <Highlight text={hit.snippet} query={q} />
          </span>
        )}
        {(hit.kind === 'poll' || hit.replyCount > 0) && (
          <span className="text-xs text-muted">{[hit.kind === 'poll' ? 'Poll' : null, replyCount(hit.replyCount)].filter(Boolean).join(' · ')}</span>
        )}
      </Link>
    </li>
  );
}

function Group({ title, icon: Icon, group, q, seeAll, onOpen, children }: {
  title: string;
  icon: LucideIcon;
  group: SearchGroup<unknown>;
  q: string;
  seeAll: string | null;
  onOpen: () => void;
  children: (onOpen: () => void, q: string) => ReactNode;
}) {
  if (group.total === 0) return null;
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <div className="flex items-center gap-2 px-2">
        <Icon size={18} aria-hidden="true" className="text-brand" />
        <h2 className="flex-1 text-base font-extrabold">{title}</h2>
        <span className="text-sm text-muted">{group.total}</span>
      </div>
      <ul className="flex flex-col">{children(onOpen, q)}</ul>
      {seeAll && group.total > group.items.length && (
        <Link to={seeAll} className="flex h-11 items-center px-2 text-sm font-bold text-brand">See all {group.total} {title.toLowerCase()}</Link>
      )}
    </section>
  );
}

export function Search() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const urlQ = params.get('q') ?? '';
  const typeParam = params.get('type');
  const type = SEARCH_TYPES.includes(typeParam as SearchType) ? (typeParam as SearchType) : null;
  const [input, setInput] = useState(urlQ);
  const [recent, setRecent] = useState<string[]>(readRecent);

  // Typing updates the URL (and so the results) after a short pause.
  useEffect(() => {
    if (input.trim() === urlQ.trim()) return;
    const t = setTimeout(() => {
      const next = new URLSearchParams();
      if (input.trim()) next.set('q', input.trim());
      if (type) next.set('type', type);
      setParams(next, { replace: true });
    }, 250);
    return () => clearTimeout(t);
  }, [input, urlQ, type, setParams]);

  const { data, isFetching, isPending, isError } = useSearch(urlQ, type);
  const q = data?.q ?? urlQ;
  const remember = () => setRecent(rememberSearch(urlQ));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    (document.activeElement as HTMLElement | null)?.blur();
    const next = new URLSearchParams();
    if (input.trim()) next.set('q', input.trim());
    if (type) next.set('type', type);
    setParams(next, { replace: true });
    setRecent(rememberSearch(input));
  };

  const total = data ? data.places.total + data.products.total + data.services.total + data.discussions.total : 0;
  const visible = type ? GROUPS.filter((g) => g.type === type) : GROUPS;
  const seeAllPath = (t: SearchType) => (type ? null : `/search?q=${encodeURIComponent(urlQ)}&type=${t}`);

  return (
    <>
      <div className="sticky top-0 z-30 -mx-4 mb-3 flex items-center gap-1 bg-bg/95 py-2 pr-4 pl-2 backdrop-blur">
        <IconButton label="Back" onClick={() => navigate(-1)}>
          <ChevronLeft size={26} aria-hidden="true" />
        </IconButton>
        <form role="search" className="relative flex-1" onSubmit={onSubmit}>
          <SearchIcon size={20} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted" />
          <input
            // The member came here to type: focus the box at once.
            autoFocus
            // The browser's own clear button is hidden in styles.css; ours is the X below.
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            aria-label="Search places, products, services and talk"
            placeholder="Search places, products and talk"
            maxLength={SEARCH_MAX}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className={`h-12 w-full rounded-full border border-line bg-surface pr-12 pl-11 text-base text-ink placeholder:text-muted ${INPUT_FOCUS}`}
          />
          {input && (
            <IconButton label="Clear search" className="absolute top-1/2 right-0.5 -translate-y-1/2" onClick={() => setInput('')}>
              <X size={20} aria-hidden="true" />
            </IconButton>
          )}
        </form>
      </div>

      {type && (
        <div className="mb-2 flex items-center gap-2">
          <Link to={`/search?q=${encodeURIComponent(urlQ)}`} className="flex h-11 items-center gap-1 text-sm font-bold text-brand">
            <ChevronLeft size={18} aria-hidden="true" /> All results
          </Link>
        </div>
      )}

      {!urlQ.trim() ? (
        recent.length > 0 ? (
          <section aria-label="Recent searches" className="flex flex-col gap-1">
            <div className="flex items-center justify-between px-2">
              <h2 className="text-sm font-bold text-muted">Recent searches</h2>
              <button type="button" className="h-11 px-2 text-sm font-bold text-brand" onClick={() => { clearRecent(); setRecent([]); }}>Clear</button>
            </div>
            <ul className="flex flex-col">
              {recent.map((r) => (
                <li key={r}>
                  <button type="button" className="flex h-12 w-full items-center gap-3 rounded-input px-2 text-left text-base hover:bg-surface-2" onClick={() => setInput(r)}>
                    <Clock size={18} aria-hidden="true" className="text-muted" />
                    <span className="truncate">{r}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="px-2 pt-2 text-xs text-muted">Recent searches stay on this device only.</p>
          </section>
        ) : (
          <p className="px-2 pt-6 text-center text-base text-muted">Try tofu, biryani, cake or an area like JLT.</p>
        )
      ) : isPending ? (
        <div role="status" aria-label="Searching" className="flex flex-col gap-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : isError ? (
        <EmptyState icon={SearchX} line="Search did not work. Please try again." />
      ) : total === 0 ? (
        <EmptyState icon={SearchX} line={`Nothing found for “${q}”. Add it so others can find it.`} action={{ label: 'Add a place', to: '/add/place' }} />
      ) : (
        <div className={isFetching ? 'flex flex-col gap-5 opacity-70 transition-opacity' : 'flex flex-col gap-5'} aria-busy={isFetching}>
          {visible.map((g) => {
            if (!data) return null;
            if (g.type === 'discussions') {
              return (
                <Group key={g.type} title={g.title} icon={g.icon} group={data.discussions} q={q} seeAll={seeAllPath(g.type)} onOpen={remember}>
                  {(onOpen, qq) => data.discussions.items.map((h) => <TopicRow key={h.id} hit={h} q={qq} onOpen={onOpen} />)}
                </Group>
              );
            }
            const group = data[g.type];
            return (
              <Group key={g.type} title={g.title} icon={g.icon} group={group} q={q} seeAll={seeAllPath(g.type)} onOpen={remember}>
                {(onOpen, qq) => group.items.map((h) => <ListingRow key={h.id} hit={h} q={qq} onOpen={onOpen} />)}
              </Group>
            );
          })}
        </div>
      )}
    </>
  );
}
