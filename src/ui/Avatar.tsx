import { cx } from '../lib/cx';
import { initials } from './Monogram';

export interface AvatarProps {
  name: string;
  /** Same origin URL, e.g. /media/<pathname>. Without it the avatar shows initials. */
  src?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES = { sm: 'size-8 text-xs', md: 'size-11 text-sm', lg: 'size-20 text-xl' };

export function Avatar({ name, src, size = 'md', className }: AvatarProps) {
  if (src) {
    return <img src={src} alt="" loading="lazy" decoding="async" className={cx('shrink-0 rounded-full object-cover', SIZES[size], className)} />;
  }
  // The initials are drawn by CSS from a data attribute: decorative, so they never become part of a
  // link's accessible name (which would then not match its label).
  return (
    <span
      aria-hidden="true"
      dir="auto"
      data-initials={initials(name)}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-brand-soft font-extrabold text-brand [unicode-bidi:isolate]',
        'before:content-[attr(data-initials)]',
        SIZES[size],
        className,
      )}
    />
  );
}
