import { cx } from '../lib/cx';

/** The VeganWay DXB wordmark. Text, so it costs no image request. */
export function Wordmark({ size = 'md', className }: { size?: 'md' | 'lg'; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2 font-extrabold tracking-tight text-ink', size === 'lg' ? 'text-2xl' : 'text-lg', className)}>
      <span>
        Vegan<span className="text-brand">Way</span>
      </span>
      {/* A real space, so the accessible text reads "VeganWay DXB" like the label. */}
      {' '}
      <span className="rounded-full bg-saffron px-2 py-0.5 text-xs font-extrabold tracking-wide text-on-saffron">DXB</span>
    </span>
  );
}
