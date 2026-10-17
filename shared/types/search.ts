// GET /api/search?q=&type=

export const SEARCH_MAX = 100;
export const SEARCH_TYPES = ['places', 'products', 'services', 'discussions'] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

export interface ListingHit {
  id: string;
  kind: 'place' | 'product' | 'service';
  name: string;
  slug: string;
  category: string;
  area: string | null;
  veganStatus: string;
  recommendCount: number;
  /** Same origin /media URL of the listing photo, or null. */
  photoUrl: string | null;
  /** The text that matched: a recommendation or reply when that is how it was found, else the summary. */
  snippet: string | null;
  matchedVia: 'listing' | 'recommendation' | 'reply';
}

export interface TopicHit {
  id: string;
  kind: 'discussion' | 'poll';
  title: string;
  snippet: string | null;
  replyCount: number;
  matchedVia: 'topic' | 'reply';
}

export interface SearchGroup<T> {
  total: number;
  items: T[];
}

export interface SearchResults {
  q: string;
  places: SearchGroup<ListingHit>;
  products: SearchGroup<ListingHit>;
  services: SearchGroup<ListingHit>;
  discussions: SearchGroup<TopicHit>;
}
