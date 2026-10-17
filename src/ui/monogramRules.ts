// Pure monogram rules, shared by the Monogram tile and its tests: which icon and tone a listing gets,
// and the initials for people (and the rare place an icon cannot go).
import {
  CakeSlice, ChefHat, Coffee, Cookie, Croissant, CupSoda, IceCreamCone, Leaf, Milk, Package, Salad, ShoppingBasket, Utensils,
  type LucideIcon,
} from 'lucide-react';

export const MONO_TONES = ['basil', 'sage', 'olive', 'saffron', 'terracotta', 'sand'] as const;
export type MonoTone = (typeof MONO_TONES)[number];

/** Category (lower case) to icon and tone. Every bakery shares a look, wherever it appears. */
const CATEGORY: Record<string, { icon: LucideIcon; tone: MonoTone }> = {
  restaurant: { icon: Utensils, tone: 'basil' },
  cafe: { icon: Coffee, tone: 'sand' },
  bakery: { icon: Croissant, tone: 'saffron' },
  desserts: { icon: IceCreamCone, tone: 'terracotta' },
  dessert: { icon: IceCreamCone, tone: 'terracotta' },
  'juice bar': { icon: CupSoda, tone: 'sage' },
  grocery: { icon: ShoppingBasket, tone: 'olive' },
  pantry: { icon: ShoppingBasket, tone: 'olive' },
  shop: { icon: ShoppingBasket, tone: 'olive' },
  'home baker': { icon: CakeSlice, tone: 'saffron' },
  caterer: { icon: ChefHat, tone: 'basil' },
  'cooking class': { icon: ChefHat, tone: 'sage' },
  'meal prep': { icon: Salad, tone: 'sage' },
  sweets: { icon: IceCreamCone, tone: 'terracotta' },
  snacks: { icon: Cookie, tone: 'sand' },
  drinks: { icon: CupSoda, tone: 'sage' },
  'dairy free': { icon: Milk, tone: 'sand' },
  'meat free': { icon: Package, tone: 'basil' },
};

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export type MonogramKind = 'place' | 'product' | 'service';

/** The icon and tone for a listing. Unknown categories fall back by kind, then to a leaf. */
export function monogramStyle(name: string, category?: string | null, kind?: MonogramKind): { icon: LucideIcon; tone: MonoTone } {
  const known = category ? CATEGORY[category.trim().toLowerCase()] : undefined;
  const tone = known?.tone ?? MONO_TONES[hash((category || name).toLowerCase()) % MONO_TONES.length];
  const icon = known?.icon ?? (kind === 'product' ? Package : kind === 'service' ? ChefHat : Leaf);
  return { icon, tone };
}

const ARABIC = /\p{Script=Arabic}/u;
const LETTER = /\p{L}/u;
const LEADING = new Set(['the', 'a', 'an']);
const UNITS = new Set(['g', 'kg', 'mg', 'ml', 'l', 'cl', 'oz', 'lb', 'lbs', 'pc', 'pcs', 'x', 'pack']);

/**
 * Up to two initials, for people and the rare place an icon cannot go. The first letter of the
 * first two words that start with a letter, skipping a leading "The" or "A", numbers and units, and
 * from one script only: when the first letter in the name is Arabic, Arabic words only.
 * Show the result inside <bdi> (or dir="auto") so mixed text keeps its order.
 */
export function initials(name: string): string {
  const firstLetter = [...name].find((c) => LETTER.test(c));
  if (!firstLetter) return '?';
  const arabic = ARABIC.test(firstLetter);
  const words = name.trim().split(/\s+/).filter((w) => {
    const c = [...w][0] ?? '';
    if (!LETTER.test(c) || ARABIC.test(c) !== arabic) return false;
    return !UNITS.has(w.toLowerCase());
  });
  while (words.length > 1 && LEADING.has(words[0].toLowerCase())) words.shift();
  const out = words.slice(0, 2).map((w) => [...w][0]).join('');
  return (out || firstLetter).toLocaleUpperCase();
}
