import { Monogram, type MonogramKind } from './Monogram';
import { cx } from '../lib/cx';

/**
 * The full bleed picture at the top of a listing, product or service page: the photo, or the
 * category monogram. The wrapper owns the size and the bleed, so nothing inside can fight it.
 */
export function HeroMedia({ name, category, kind, photoUrl, className }: {
  name: string;
  category?: string | null;
  kind?: MonogramKind;
  photoUrl: string | null;
  className?: string;
}) {
  return (
    <div data-testid="hero" className={cx('relative -mx-4 h-56 overflow-hidden bg-surface-2', className)}>
      {photoUrl
        ? <img src={photoUrl} alt="" loading="eager" decoding="async" fetchPriority="high" className="absolute inset-0 size-full object-cover" />
        : <Monogram name={name} category={category} kind={kind} size="hero" />}
    </div>
  );
}
