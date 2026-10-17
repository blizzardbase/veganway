// Types shared by the Home feed API (server/routes/feed.ts) and the Home screen (src/features/home).
import type { Author, ListingKind, VeganStatus } from './listings.js';
import type { TopicSummary } from './talk.js';

export const FEED_PAGE_SIZE = 20;
export const FEED_PAGE_MAX = 50;
/** Recommendations on one listing closer together than this collapse into one feed item. */
export const FEED_COLLAPSE_MINUTES = 60;
export const FEED_EXCERPT_MAX = 180;
export const FEED_PINNED_MAX = 5;

/** The listing behind a feed item, with what a card needs. */
export interface FeedListing {
  id: string;
  slug: string;
  kind: ListingKind;
  name: string;
  category: string;
  /** Places: one of DUBAI_AREAS. Products and services may have none. */
  area: string | null;
  stores: string[];
  veganStatus: VeganStatus;
  photoUrl: string | null;
  recommendCount: number;
  activeOfferCount: number;
  runByOwner: boolean;
}

interface FeedItemBase {
  /** Stable across pages and refetches: "listing:<id>", "rec:<id of the first in its group>", "topic:<id>". */
  id: string;
  /** When the item happened. For a collapsed group, the newest recommendation in it. */
  at: string;
}

/** A new place, product or service. The creator's first "what to order" rides along. */
export interface FeedListingAdded extends FeedItemBase {
  type: 'listing_added';
  listing: FeedListing & { summary: string };
  addedBy: Author;
  /** What the creator said to order when adding it, or null. */
  whatToOrder: string | null;
}

/** One recommendation, or several on the same listing within an hour, collapsed. */
export interface FeedRecommendation extends FeedItemBase {
  type: 'recommendation';
  listing: FeedListing;
  /** The newest recommendation in the group. */
  recommendation: {
    id: string;
    excerpt: string;
    author: Author;
    /** The recommendation's own photo, or null. Cards fall back to the listing photo. */
    photoUrl: string | null;
    upvotes: number;
    upvotedByMe: boolean;
    offer: string | null;
    /** Set only while the offer is still running. */
    offerExpiresAt: string | null;
  };
  /** How many recommendations this item stands for. 1 when nothing collapsed. */
  count: number;
  /** Up to three distinct author names in the group, newest first. */
  authors: string[];
}

/** A discussion or poll. Polls carry Talk's rule: results only after the viewer voted or it closed. */
export interface FeedTopic extends FeedItemBase {
  type: 'topic';
  topic: TopicSummary;
}

export type FeedItem = FeedListingAdded | FeedRecommendation | FeedTopic;
export type FeedItemType = FeedItem['type'];

/** GET /api/feed?cursor=&limit= */
export interface FeedPage {
  items: FeedItem[];
  nextCursor: string | null;
}

/** GET /api/feed/pinned */
export interface PinnedResponse {
  items: TopicSummary[];
}
