// Types and fixed choices shared by the listings API (server/routes/listings.ts, photos.ts)
// and the client (src/features/listings, Explore, ListingDetail). No imports: both sides load it.

export type ListingKind = 'place' | 'product' | 'service';
export type VeganStatus = 'fully_vegan' | 'vegan_options' | 'vegan_product';
export type OpinionValue = 'recommend' | 'not_for_me';
export type ListingSort = 'top' | 'new';

/** The one wording for a vegan status, on every screen, chip and error message. */
export const VEGAN_STATUS_LABEL: Record<VeganStatus, string> = {
  fully_vegan: 'Fully vegan',
  vegan_options: 'Vegan options',
  vegan_product: 'Vegan product',
};

/** "Fully vegan", "Vegan options" or "Vegan product"; null for a value that is not a status. */
export function veganStatusLabel(status: string): string | null {
  return Object.hasOwn(VEGAN_STATUS_LABEL, status) ? VEGAN_STATUS_LABEL[status as VeganStatus] : null;
}

/** The error when a place or service has no status chosen. */
export const VEGAN_STATUS_REQUIRED = `Choose ${VEGAN_STATUS_LABEL.fully_vegan} or ${VEGAN_STATUS_LABEL.vegan_options}.`;

/** Canonical area values for places, services, imports and Explore. */
export const DUBAI_AREAS = [
  'Downtown Dubai',
  'Business Bay',
  'DIFC',
  'Dubai Marina',
  'JBR',
  'JLT',
  'Palm Jumeirah',
  'Jumeirah',
  'Umm Suqeim',
  'Al Barsha',
  'Al Quoz',
  'Al Wasl',
  'City Walk',
  'Dubai Hills',
  'JVC',
  'Karama',
  'Bur Dubai',
  'Deira',
  'Mirdif',
  'Silicon Oasis',
  'Arabian Ranches',
  'Motor City',
  'Satwa',
  'Delivery only',
] as const;

export type DubaiArea = (typeof DUBAI_AREAS)[number];

/** Labels can change without changing stored area values. */
export function areaLabel(area: string): string {
  return area === 'Delivery only' ? 'Delivers across Dubai' : area;
}

export const STORES = ['Carrefour', 'Spinneys', 'Waitrose', 'Lulu', 'Kibsons', 'Choithrams', 'Online', 'Other'] as const;

/** Optional categories. The monogram tint follows the category. */
export const PLACE_CATEGORIES = ['Restaurant', 'Cafe', 'Bakery', 'Desserts', 'Juice bar', 'Other'] as const;
export const PRODUCT_CATEGORIES = ['Dairy free', 'Meat free', 'Snacks', 'Sweets', 'Bakery', 'Drinks', 'Pantry', 'Other'] as const;
/** Service categories, owned by the services slice; repeated here only for the Explore filter chips. */
export const SERVICE_CATEGORIES = ['Home baker', 'Caterer', 'Meal prep', 'Cooking class', 'Shop', 'Other'] as const;

export const NAME_MAX = 80;
export const BODY_MAX = 1000;
export const OFFER_MAX = 200;
export const SUMMARY_MAX = 300;
/** How long an offer may run, in days from today. */
export const OFFER_MAX_DAYS = 90;
/** A listing's creator may edit it for this long. Admins always may. */
export const EDIT_WINDOW_HOURS = 24;
export const PAGE_SIZE = 20;
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

/** What a public read shows about a member: the pseudonym and optional public profile fields only. */
export interface Author {
  pseudonym: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface ListingCard {
  id: string;
  kind: ListingKind;
  slug: string;
  name: string;
  category: string;
  area: string | null;
  stores: string[];
  veganStatus: VeganStatus;
  summary: string;
  photoUrl: string | null;
  recommendCount: number;
  notForMeCount: number;
  activeOfferCount: number;
  /** True when an owner runs the listing (services, after a claim). */
  runByOwner: boolean;
  /** Only ever true for admins. */
  hidden: boolean;
  createdAt: string;
}

export interface ActiveOffer {
  recommendationId: string;
  offer: string;
  /** End of the chosen day, Dubai time, as an ISO string. */
  offerExpiresAt: string;
  createdAt: string;
  author: Author;
}

export interface ListingDetail extends ListingCard {
  tags: string[];
  mapsUrl: string | null;
  createdBy: Author;
  /** The viewer added it. */
  mine: boolean;
  /** The viewer may edit it: its creator within 24 hours, or an admin. */
  canEdit: boolean;
  myOpinion: OpinionValue | null;
  saved: boolean;
  offers: ActiveOffer[];
}

export interface Recommendation {
  id: string;
  listingId: string;
  body: string;
  offer: string | null;
  offerExpiresAt: string | null;
  photoUrl: string | null;
  upvotes: number;
  upvotedByMe: boolean;
  mine: boolean;
  author: Author;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  /** Pass back as ?cursor= for the next page. Null when there is no more. */
  nextCursor: string | null;
}

export interface ListingSuggestion {
  id: string;
  slug: string;
  kind: ListingKind;
  name: string;
  area: string | null;
  stores: string[];
  veganStatus: VeganStatus;
}

export interface OpinionCounts {
  recommendCount: number;
  notForMeCount: number;
  myOpinion: OpinionValue | null;
}

/** GET /api/listings/offers/active: unexpired offers, newest first, for the Deals strip. */
export interface DealItem extends ActiveOffer {
  listing: { id: string; slug: string; kind: ListingKind; name: string; category: string; photoUrl: string | null };
}

export interface PhotoResponse {
  id: string;
  url: string;
  width: number;
  height: number;
}

/** POST /api/listings */
export interface CreateListingBody {
  kind: 'place' | 'product';
  name: string;
  veganStatus: VeganStatus;
  category?: string;
  /** Place only. One of DUBAI_AREAS. */
  area?: string;
  /** Product only. Each one of STORES. */
  stores?: string[];
  summary?: string;
  /** Optional first recommendation: what to order or buy. */
  whatToOrder?: string;
  /** The creator's own opinion. The form starts unselected. Null records none. */
  opinion?: OpinionValue | null;
  mapsUrl?: string;
  photoId?: string;
}

/** POST /api/listings/:slug/recommendations. Body, offer or both. An offer needs an expiry date. */
export interface CreateRecommendationBody {
  body?: string;
  offer?: string;
  /** YYYY-MM-DD. The offer runs to the end of that day, Dubai time. */
  offerExpiresOn?: string;
  photoId?: string;
}

/** Path for a listing's own screen in the client. */
export function listingPath(l: { kind: ListingKind; slug: string }): string {
  return l.kind === 'place' ? `/places/${l.slug}` : l.kind === 'product' ? `/products/${l.slug}` : `/services/${l.slug}`;
}
