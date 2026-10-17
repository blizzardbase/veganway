// The member's own space: profile, posts, saved, service, account deletion.

export type ThemePreference = 'system' | 'light' | 'dark';

export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 40;

/** GET /api/me/profile and the result of PATCH /api/me/profile. */
export interface Profile {
  pseudonym: string;
  displayName: string | null;
  bio: string | null;
  avatarPhotoId: string | null;
  avatarUrl: string | null;
  theme: ThemePreference;
  hasService: boolean;
  role: 'member' | 'admin';
}

/** PATCH /api/me/profile. null clears a field; a missing key leaves it alone. */
export interface UpdateProfileBody {
  displayName?: string | null;
  bio?: string | null;
  avatarPhotoId?: string | null;
  theme?: ThemePreference;
}

export interface MyListingPost {
  id: string;
  kind: 'place' | 'product' | 'service';
  name: string;
  slug: string;
  hidden: boolean;
  createdAt: string;
}

export interface MyRecommendationPost {
  id: string;
  body: string;
  offer: string | null;
  listing: { name: string; slug: string; kind: 'place' | 'product' | 'service' };
  hidden: boolean;
  createdAt: string;
}

export interface MyTopicPost {
  id: string;
  kind: 'discussion' | 'poll';
  title: string;
  hidden: boolean;
  createdAt: string;
}

export interface MyReplyPost {
  id: string;
  body: string;
  /** Where the reply lives: a topic or a listing. */
  on: { type: 'topic'; id: string; title: string } | { type: 'listing'; id: string; name: string; slug: string; kind: 'place' | 'product' | 'service' } | null;
  hidden: boolean;
  createdAt: string;
}

/** GET /api/me/posts */
export interface MyPosts {
  listings: MyListingPost[];
  recommendations: MyRecommendationPost[];
  topics: MyTopicPost[];
  replies: MyReplyPost[];
}

export interface SavedListing {
  id: string;
  kind: 'place' | 'product' | 'service';
  name: string;
  slug: string;
  category: string;
  area: string | null;
  veganStatus: string;
  savedAt: string;
}

/** GET /api/me/saved */
export interface MySaved {
  items: SavedListing[];
}

/** GET /api/me/service */
export interface MyService {
  service: { id: string; name: string; slug: string; kind: 'place' | 'product' | 'service' } | null;
  pendingClaims: { id: string; code: string; listing: { name: string; slug: string; kind: 'place' | 'product' | 'service' }; createdAt: string }[];
}

/** POST /api/me/delete */
export interface DeleteAccountBody {
  password: string;
}

export const FORMER_MEMBER = 'Former member';
