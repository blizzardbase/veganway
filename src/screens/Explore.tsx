// Explore: Places | Products | Services, filter chips, a sort sheet, cards and Load more.
// Filters live in the URL so Back returns to the same list and scroll position.
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { ArrowDownUp, ChefHat, ChevronDown, SearchX, ShoppingBasket, Store, Tag as TagIcon } from 'lucide-react';
import { Button, Chip, ChipRow, EmptyState, ListSkeleton, SearchPill, Segmented, Sheet } from '../ui';
import { ListingCard } from '../features/listings/ListingCard';
import { AreaSheet } from '../features/listings/AreaSheet';
import { flatUnique, useListings, type ListingFilters } from '../features/listings/api';
import { errorMessage } from '../api/client';
import {
  areaLabel, PLACE_CATEGORIES, PRODUCT_CATEGORIES, SERVICE_CATEGORIES, STORES, VEGAN_STATUS_LABEL,
  type ListingKind, type ListingSort, type VeganStatus,
} from '../../shared/types/listings';

const SEGMENTS: { value: ListingKind; label: string }[] = [
  { value: 'place', label: 'Places' },
  { value: 'product', label: 'Products' },
  { value: 'service', label: 'Services' },
];

const SORT_LABEL: Record<ListingSort, string> = { top: 'Most recommended', new: 'Newest' };

const EMPTY: Record<ListingKind, { line: string; label: string; to: string; icon: typeof Store }> = {
  place: { line: 'No places yet. Add the first one.', label: 'Add a place', to: '/add/place', icon: Store },
  product: { line: 'No products yet. Add the first one.', label: 'Add a product', to: '/add/product', icon: ShoppingBasket },
  service: { line: 'No services yet. Add the first one.', label: 'Add a service', to: '/add/service', icon: ChefHat },
};

type Picker = 'area' | 'category' | 'store' | 'sort' | null;

function categoriesFor(kind: ListingKind): readonly string[] {
  return kind === 'place' ? PLACE_CATEGORIES : kind === 'product' ? PRODUCT_CATEGORIES : SERVICE_CATEGORIES;
}

function readFilters(params: URLSearchParams): ListingFilters {
  const kindParam = params.get('kind');
  const kind: ListingKind = kindParam === 'product' || kindParam === 'service' ? kindParam : 'place';
  const status = params.get('status');
  return {
    kind,
    sort: params.get('sort') === 'new' ? 'new' : 'top',
    area: kind !== 'product' ? params.get('area') ?? undefined : undefined,
    store: kind === 'product' ? params.get('store') ?? undefined : undefined,
    category: params.get('category') ?? undefined,
    veganStatus: kind === 'place' && (status === 'fully_vegan' || status === 'vegan_options') ? (status as VeganStatus) : undefined,
    hasOffer: kind !== 'service' && params.get('offer') === '1' ? true : undefined,
  };
}

export function Explore() {
  const [params, setParams] = useSearchParams();
  const filters = readFilters(params);
  const [picker, setPicker] = useState<Picker>(null);
  const query = useListings(filters);
  const items = flatUnique(query.data?.pages);
  const filtered = Boolean(filters.area || filters.store || filters.category || filters.veganStatus || filters.hasOffer);

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true, preventScrollReset: true });
  };

  const setKind = (kind: ListingKind) => {
    const next = new URLSearchParams();
    if (kind !== 'place') next.set('kind', kind);
    if (filters.sort === 'new') next.set('sort', 'new');
    setParams(next, { replace: true });
  };

  const pick = (key: 'area' | 'category' | 'store', value: string | null) => {
    update({ [key]: value });
    setPicker(null);
  };

  const empty = EMPTY[filters.kind];
  const pickerOptions: readonly string[] = picker === 'store' ? STORES : picker === 'category' ? categoriesFor(filters.kind) : [];
  const pickerValue = picker === 'store' ? filters.store : picker === 'category' ? filters.category : undefined;
  const pickerTitle = picker === 'store' ? 'Store' : picker === 'category' ? 'Category' : 'Sort by';

  return (
    <>
      <header className="flex h-14 items-center">
        <h1 className="text-xl font-extrabold">Explore</h1>
      </header>
      <div className="sticky top-0 z-30 -mx-4 flex flex-col gap-2 bg-bg/95 px-4 pt-2 pb-2 backdrop-blur">
        <SearchPill />
        <Segmented<ListingKind> label="Show" options={SEGMENTS} value={filters.kind} onChange={setKind} />
        <ChipRow label="Filters">
          <Chip selected={false} onClick={() => setPicker('sort')} icon={<ArrowDownUp size={16} aria-hidden="true" />}>
            {SORT_LABEL[filters.sort]}
          </Chip>
          {filters.kind !== 'product' && (
            <Chip selected={Boolean(filters.area)} onClick={() => setPicker('area')} icon={<ChevronDown size={16} aria-hidden="true" />}>
              {filters.area ? areaLabel(filters.area) : 'Area'}
            </Chip>
          )}
          {filters.kind === 'product' && (
            <Chip selected={Boolean(filters.store)} onClick={() => setPicker('store')} icon={<ChevronDown size={16} aria-hidden="true" />}>
              {filters.store ?? 'Store'}
            </Chip>
          )}
          {filters.kind === 'place' && (
            <>
              <Chip selected={filters.veganStatus === 'fully_vegan'} onClick={() => update({ status: filters.veganStatus === 'fully_vegan' ? null : 'fully_vegan' })}>
                {VEGAN_STATUS_LABEL.fully_vegan}
              </Chip>
              <Chip selected={filters.veganStatus === 'vegan_options'} onClick={() => update({ status: filters.veganStatus === 'vegan_options' ? null : 'vegan_options' })}>
                {VEGAN_STATUS_LABEL.vegan_options}
              </Chip>
            </>
          )}
          <Chip selected={Boolean(filters.category)} onClick={() => setPicker('category')} icon={<ChevronDown size={16} aria-hidden="true" />}>
            {filters.category ?? 'Category'}
          </Chip>
          {filters.kind !== 'service' && (
            <Chip selected={Boolean(filters.hasOffer)} onClick={() => update({ offer: filters.hasOffer ? null : '1' })} icon={<TagIcon size={16} aria-hidden="true" />}>
              Offers
            </Chip>
          )}
        </ChipRow>
      </div>

      <section aria-label={SEGMENTS.find((s) => s.value === filters.kind)?.label} className="mt-2 flex flex-col gap-3">
        {query.isPending ? (
          <ListSkeleton count={4} label="Loading listings" />
        ) : query.isError ? (
          <EmptyState icon={SearchX} line={errorMessage(query.error)} action={{ label: 'Try again', onClick: () => void query.refetch() }} />
        ) : items.length === 0 ? (
          filtered
            ? <EmptyState icon={SearchX} line="Nothing matches these filters yet." action={{ label: 'Clear filters', onClick: () => setKind(filters.kind) }} />
            : <EmptyState icon={empty.icon} line={empty.line} action={{ label: empty.label, to: empty.to }} />
        ) : (
          <>
            <ul className="flex flex-col gap-3">
              {items.map((l) => (
                <li key={l.id}><ListingCard listing={l} /></li>
              ))}
            </ul>
            {query.hasNextPage && (
              <Button variant="secondary" block busy={query.isFetchingNextPage} busyLabel="Loading" onClick={() => void query.fetchNextPage()}>
                Load more
              </Button>
            )}
          </>
        )}
      </section>

      <AreaSheet open={picker === 'area'} onClose={() => setPicker(null)} value={filters.area} onPick={(a) => pick('area', a)} allowAny />

      <Sheet open={picker !== null && picker !== 'area'} onClose={() => setPicker(null)} title={pickerTitle}>
        {picker === 'sort' ? (
          <div role="radiogroup" aria-label="Sort by" className="flex flex-col gap-2 pb-2">
            {(['top', 'new'] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={filters.sort === s}
                onClick={() => {
                  update({ sort: s === 'top' ? null : s });
                  setPicker(null);
                }}
                className="flex h-12 items-center justify-between rounded-input border border-line bg-surface px-4 text-left text-base font-semibold aria-checked:border-brand aria-checked:bg-brand-soft aria-checked:text-brand"
              >
                {SORT_LABEL[s]}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 pb-2">
            <Chip selected={!pickerValue} onClick={() => picker && pick(picker, null)}>Any</Chip>
            {pickerOptions.map((o) => (
              <Chip key={o} selected={pickerValue === o} onClick={() => picker && pick(picker, o)}>{o}</Chip>
            ))}
          </div>
        )}
      </Sheet>
    </>
  );
}
