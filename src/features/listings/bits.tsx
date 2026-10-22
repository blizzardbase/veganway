// Small pieces shared by listing cards, the detail screen and the Add forms.
import { BadgeCheck, Leaf, Tag as TagIcon } from 'lucide-react';
import { Chip, Monogram, Tag } from '../../ui';
import { cx } from '../../lib/cx';
import { veganStatusLabel, type VeganStatus } from '../../../shared/types/listings';

/** The vegan status tag, worded by veganStatusLabel everywhere. Renders nothing for an unknown value. */
export function VeganStatusTag({ status }: { status: VeganStatus | string }) {
  const label = veganStatusLabel(status);
  if (!label) return null;
  return (
    <Tag tone="soft" className={status === 'vegan_options' ? 'vegan-options-tag' : undefined}>
      <Leaf size={12} aria-hidden="true" />
      {label}
    </Tag>
  );
}

export function OfferBadge({ count }: { count: number }) {
  if (count < 1) return null;
  return (
    <Tag tone="saffron">
      <TagIcon size={12} aria-hidden="true" />
      {count === 1 ? 'Offer' : `${count} offers`}
    </Tag>
  );
}

export function OwnerBadge() {
  return (
    <Tag tone="soft">
      <BadgeCheck size={12} aria-hidden="true" />
      Run by owner
    </Tag>
  );
}

/** A listing's photo, or the monogram tinted by its category. Decorative: the name is always beside it. */
export function ListingThumb({ name, category, kind, photoUrl, size = 'md', className }: {
  name: string; category: string; kind?: 'place' | 'product' | 'service'; photoUrl: string | null; size?: 'sm' | 'md' | 'hero'; className?: string;
}) {
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt=""
        loading={size === 'hero' ? 'eager' : 'lazy'}
        decoding="async"
        className={cx(size === 'hero' ? 'h-56 w-full rounded-card' : size === 'sm' ? 'size-11 rounded-input' : 'size-16 rounded-card', 'shrink-0 bg-surface-2 object-cover', className)}
      />
    );
  }
  if (size === 'hero') {
    return (
      <div className={cx('overflow-hidden rounded-card', className)}>
        <div className="h-56"><Monogram name={name} category={category} kind={kind} size="hero" /></div>
      </div>
    );
  }
  return <Monogram name={name} category={category} kind={kind} size={size === 'sm' ? 'sm' : 'md'} className={className} />;
}

/** "12 Nov", for offer end dates and post dates. */
export function formatDay(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Dubai' }).format(new Date(iso));
}

/** A labelled group of chips where one (or, with multiple, several) can be chosen. */
export function ChoiceChips<T extends string>({ label, options, value, onChange, multiple, wrap = true, error, labelFor }: {
  label: string;
  options: readonly T[];
  value: T[];
  onChange: (next: T[]) => void;
  multiple?: boolean;
  wrap?: boolean;
  error?: string | null;
  labelFor?: (o: T) => string;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 text-sm font-bold text-ink">{label}</legend>
      <div className={cx('flex gap-2', wrap ? 'flex-wrap' : 'no-scrollbar -mx-4 overflow-x-auto px-4')}>
        {options.map((o) => {
          const selected = value.includes(o);
          return (
            <Chip
              key={o}
              selected={selected}
              onClick={() => {
                if (multiple) onChange(selected ? value.filter((v) => v !== o) : [...value, o]);
                else onChange(selected ? [] : [o]);
              }}
            >
              {labelFor ? labelFor(o) : o}
            </Chip>
          );
        })}
      </div>
      {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
    </fieldset>
  );
}
