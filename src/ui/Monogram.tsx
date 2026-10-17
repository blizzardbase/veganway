// The tile a listing shows when it has no photo. At launch almost nothing has a photo, so this
// carries the look of the app: a category icon on a Basil and Saffron tone, never an odd pair of
// letters. Small tiles show the icon; medium, large and hero tiles add a soft gradient and pattern.
import { useId } from 'react';
import { cx } from '../lib/cx';
import { monogramStyle, type MonogramKind, type MonoTone } from './monogramRules';

/** Full class strings, so Tailwind sees every one. Tile, gradient end, and ink with 4.5:1 or more. */
const TONE: Record<MonoTone, { tile: string; gradient: string; ink: string }> = {
  basil: { tile: 'bg-mono-basil', gradient: 'from-mono-basil to-mono-basil-2', ink: 'text-on-mono-basil' },
  sage: { tile: 'bg-mono-sage', gradient: 'from-mono-sage to-mono-sage-2', ink: 'text-on-mono-sage' },
  olive: { tile: 'bg-mono-olive', gradient: 'from-mono-olive to-mono-olive-2', ink: 'text-on-mono-olive' },
  saffron: { tile: 'bg-mono-saffron', gradient: 'from-mono-saffron to-mono-saffron-2', ink: 'text-on-mono-saffron' },
  terracotta: { tile: 'bg-mono-terracotta', gradient: 'from-mono-terracotta to-mono-terracotta-2', ink: 'text-on-mono-terracotta' },
  sand: { tile: 'bg-mono-sand', gradient: 'from-mono-sand to-mono-sand-2', ink: 'text-on-mono-sand' },
};

/** Tile and ink classes for a tone, for small custom marks (a chip's dot) that reuse the palette. */
export function monoTileClass(tone: MonoTone): string {
  return `${TONE[tone].tile} ${TONE[tone].ink}`;
}

export interface MonogramProps {
  name: string;
  /** The look follows the category, so all bakeries share an icon and tone. */
  category?: string | null;
  kind?: MonogramKind;
  size?: 'sm' | 'md' | 'lg' | 'hero';
  className?: string;
}

const SIZES = {
  sm: { box: 'size-11 rounded-input', icon: 20 },
  md: { box: 'size-16 rounded-card', icon: 28 },
  lg: { box: 'size-24 rounded-card', icon: 40 },
  // No width here: the hero fills whatever box its parent gives it (see HeroMedia).
  hero: { box: 'size-full', icon: 56 },
};

/** A soft dotted pattern, drawn in the tone's ink at low opacity. */
function Pattern({ dense }: { dense: boolean }) {
  const id = useId();
  const step = dense ? 14 : 22;
  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full opacity-[0.14]">
      <defs>
        <pattern id={id} width={step} height={step} patternUnits="userSpaceOnUse">
          <circle cx={step / 2} cy={step / 2} r={dense ? 1.2 : 1.6} fill="currentColor" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/** Decorative: the listing name is always shown beside it. */
export function Monogram({ name, category, kind, size = 'md', className }: MonogramProps) {
  const { icon: Icon, tone } = monogramStyle(name, category, kind);
  const t = TONE[tone];
  const s = SIZES[size];
  if (size === 'sm') {
    return (
      <div aria-hidden="true" data-tone={tone} className={cx('flex shrink-0 items-center justify-center', t.tile, t.ink, s.box, className)}>
        <Icon size={s.icon} strokeWidth={2} />
      </div>
    );
  }
  const hero = size === 'hero';
  return (
    <div
      aria-hidden="true"
      data-tone={tone}
      className={cx('relative flex shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br', t.gradient, t.ink, s.box, className)}
    >
      <Pattern dense={!hero} />
      {hero ? (
        <>
          <span className="absolute -top-16 -right-12 size-48 rounded-full bg-current opacity-[0.07]" />
          <span className="absolute -bottom-20 -left-10 size-40 rounded-full bg-current opacity-[0.05]" />
          <span className="relative flex size-28 items-center justify-center rounded-full bg-surface/55 shadow-1 ring-1 ring-current/10">
            <Icon size={s.icon} strokeWidth={1.75} />
          </span>
        </>
      ) : (
        <Icon size={s.icon} strokeWidth={1.9} className="relative" />
      )}
    </div>
  );
}
export { MONO_TONES, initials, monogramStyle, type MonoTone, type MonogramKind } from './monogramRules';
