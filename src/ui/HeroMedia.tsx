import { m, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { Monogram, type MonogramKind } from './Monogram';
import { cx } from '../lib/cx';

/**
 * The full bleed picture at the top of a listing, product or service page: the photo, or the
 * category monogram. The wrapper owns the size and the bleed, so nothing inside can fight it.
 */
export function HeroMedia({ name, category, kind, photoUrl, className, transitionKey }: {
  transitionKey?: string;
  name: string;
  category?: string | null;
  kind?: MonogramKind;
  photoUrl: string | null;
  className?: string;
}) {
  const still = useReducedMotion();
  const { scrollY } = useScroll();
  const scale = useTransform(scrollY, [0, 400], [1, 1.12]);
  const y = useTransform(scrollY, [0, 400], [0, 36]);
  return (
    <m.div layoutId={still || !transitionKey ? undefined : `listing-media-${transitionKey}`} transition={{ type: 'spring', stiffness: 380, damping: 36 }} data-testid="hero" className={cx('hero-media relative -mx-4 h-56 overflow-hidden bg-surface-2', className)}>
      <m.div className="absolute inset-0" style={still ? undefined : { scale, y }}>
        {photoUrl
          ? <img src={photoUrl} alt="" loading="eager" decoding="async" fetchPriority="high" className="absolute inset-0 size-full object-cover" />
          : <Monogram name={name} category={category} kind={kind} size="hero" />}
      </m.div>
    </m.div>
  );
}
