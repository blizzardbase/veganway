// Types and limits shared by the talk API (server/routes/talk.ts) and its screens.

export const TOPIC_TITLE_MIN = 4;
export const TOPIC_TITLE_MAX = 120;
export const TOPIC_BODY_MAX = 4000;
export const TOPIC_TAGS_MAX = 5;
export const TAG_MAX = 24;
export const TOPIC_LISTINGS_MAX = 3;
export const POLL_OPTIONS_MIN = 2;
export const POLL_OPTIONS_MAX = 6;
export const POLL_OPTION_MAX = 80;
export const POLL_DAYS_DEFAULT = 7;
export const POLL_DAYS_MAX = 30;
export const REPLY_MAX = 2000;

export type TopicKind = 'discussion' | 'poll';
export type TopicSort = 'hot' | 'new';
export type ReplyTargetType = 'listing' | 'topic';
export type ListingKind = 'place' | 'product' | 'service';

/** Public author fields only. A deleted account shows as "Former member". */
export interface Author {
  name: string;
  former: boolean;
}

export interface PollOption {
  id: string;
  label: string;
  /** Present only when results are visible to this viewer. */
  votes?: number;
}

export interface Poll {
  options: PollOption[];
  /** Present only when results are visible to this viewer, like each option's votes. */
  totalVotes?: number;
  /** The viewer's choice, or null. Always null when signed out. */
  myVote: string | null;
  closesAt: string;
  closed: boolean;
  /** True after the viewer voted or after the poll closed. Then every option carries votes. */
  resultsVisible: boolean;
}

export interface LinkedListing {
  id: string;
  name: string;
  slug: string;
  kind: ListingKind;
}

export interface TopicSummary {
  id: string;
  kind: TopicKind;
  title: string;
  /** First line of the body, trimmed. Empty when there is no body. */
  excerpt: string;
  tags: string[];
  pinned: boolean;
  author: Author;
  createdAt: string;
  replyCount: number;
  upvotes: number;
  upvoted: boolean;
  mine: boolean;
  /** Only for admins: the topic is hidden from members. */
  hidden?: boolean;
  poll: Poll | null;
}

export interface TopicDetail extends TopicSummary {
  body: string | null;
  listings: LinkedListing[];
}

/** GET /api/talk/topics */
export interface TopicListResponse {
  items: TopicSummary[];
  nextCursor: string | null;
}

/** GET /api/talk/topics/:id and POST /api/talk/topics (201) */
export interface TopicResponse {
  topic: TopicDetail;
}

/** GET /api/talk/linked?listing_id= */
export interface LinkedTopicsResponse {
  items: TopicSummary[];
  total: number;
}

/** GET /api/talk/tags: the most used tags, for the filter chips. */
export interface TagsResponse {
  tags: string[];
}

export interface CreateDiscussionBody {
  kind: 'discussion';
  title: string;
  body?: string | null;
  tags?: string[];
  listingIds?: string[];
}

export interface CreatePollBody {
  kind: 'poll';
  title: string;
  body?: string | null;
  tags?: string[];
  listingIds?: string[];
  options: string[];
  /** 1 to 30. Default 7. Ignored when closesAt is given. */
  durationDays?: number;
  /** ISO time in the future, at most 30 days away. */
  closesAt?: string;
}

export type CreateTopicBody = CreateDiscussionBody | CreatePollBody;

/** POST /api/talk/topics/:id/vote */
export interface VoteResponse {
  poll: Poll;
}

/** POST /api/talk/topics/:id/upvote and /api/talk/replies/:id/upvote: a toggle. */
export interface UpvoteResponse {
  upvoted: boolean;
  upvotes: number;
}

/** POST /api/talk/topics/:id/pin (admin) */
export interface PinResponse {
  pinned: boolean;
}

export interface Reply {
  id: string;
  parentId: string | null;
  /** Empty when deleted. */
  body: string;
  deleted: boolean;
  /** Null when deleted. */
  author: Author | null;
  createdAt: string;
  upvotes: number;
  upvoted: boolean;
  mine: boolean;
  hidden?: boolean;
}

export interface ReplyThread extends Reply {
  replies: Reply[];
}

/** GET /api/talk/replies?target_type=&target_id=&cursor=&limit=, paginated by top level thread. */
export interface RepliesResponse {
  items: ReplyThread[];
  total: number;
  nextCursor: string | null;
}

export interface CreateReplyBody {
  targetType: ReplyTargetType;
  targetId: string;
  parentId?: string | null;
  body: string;
}

/** POST /api/talk/replies (201) */
export interface ReplyResponse {
  reply: Reply;
}

/** Normalise a tag the same way on both sides: trimmed, single spaces, lower case. */
export function normalizeTag(tag: string): string {
  return tag.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}
