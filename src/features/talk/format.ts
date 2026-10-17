// Small display helpers for talk screens.
import type { ListingKind } from '../../../shared/types/talk';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "now", "5m", "3h", "2d", "4w", then a short date. */
export function age(iso: string, now = Date.now()): string {
  const ms = Math.max(0, now - Date.parse(iso));
  if (ms < MIN) return 'now';
  if (ms < HOUR) return `${Math.floor(ms / MIN)}m`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`;
  if (ms < 28 * DAY) return `${Math.floor(ms / DAY)}d`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** "Closes in 3 days", "Closes in 5 hours", "Closes soon", "Closed". */
export function closesIn(iso: string, closed: boolean, now = Date.now()): string {
  if (closed) return 'Closed';
  const ms = Date.parse(iso) - now;
  if (ms <= 0) return 'Closed';
  if (ms >= DAY) {
    const d = Math.round(ms / DAY);
    return `Closes in ${d} ${d === 1 ? 'day' : 'days'}`;
  }
  if (ms >= HOUR) {
    const h = Math.round(ms / HOUR);
    return `Closes in ${h} ${h === 1 ? 'hour' : 'hours'}`;
  }
  return 'Closes soon';
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A plain wa.me link with text and the page URL. No script, no request from our page. */
export function whatsappShare(text: string, path: string): string {
  const url = `${window.location.origin}${path}`;
  return `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
}

export function listingHref(l: { kind: ListingKind; slug: string }): string {
  const base = l.kind === 'place' ? 'places' : l.kind === 'product' ? 'products' : 'services';
  return `/${base}/${encodeURIComponent(l.slug)}`;
}

/** Session storage that never throws (private mode, blocked storage). */
export const draftStore = {
  get(key: string): string {
    try {
      return sessionStorage.getItem(key) ?? '';
    } catch {
      return '';
    }
  },
  set(key: string, value: string): void {
    try {
      if (value) sessionStorage.setItem(key, value);
      else sessionStorage.removeItem(key);
    } catch {
      // Storage blocked: the draft lives only in memory.
    }
  },
};
