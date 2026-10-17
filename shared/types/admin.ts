// Reports and the admin queue.

export const REPORT_TARGETS = ['listing', 'recommendation', 'topic', 'reply', 'photo', 'user'] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];

export const REPORT_REASONS = ['spam', 'wrong_info', 'offensive', 'personal_info', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: 'Spam or advertising',
  wrong_info: 'Wrong information',
  offensive: 'Offensive',
  personal_info: 'Shares personal information',
  other: 'Something else',
};

/**
 * Distinct reporters, each with an account older than REPORT_ACCOUNT_AGE_HOURS, that hide a target
 * automatically. Never for a recommendation or reply on a listing when one reporter owns that listing.
 */
export const AUTO_HIDE_REPORTS = 3;
export const REPORT_ACCOUNT_AGE_HOURS = 72;
export const REPORT_NOTE_MAX = 300;

/** POST /api/reports. snake_case keys are accepted too. */
export interface ReportBody {
  targetType: ReportTarget;
  targetId: string;
  reason: ReportReason;
  note?: string;
}

export interface ReportCreated {
  ok: true;
  /** True when this report was the one that hid the target. */
  hidden: boolean;
}

/** A short look at the reported thing, so an admin can decide without opening it. */
export interface TargetPreview {
  title: string;
  excerpt: string | null;
  /** App path to open the thing, when it has a page. */
  path: string | null;
  hidden: boolean;
  /** Author pseudonym where there is one. */
  author: string | null;
  authorId: string | null;
  exists: boolean;
}

/** GET /api/admin/reports: one row per reported target. */
export interface ReportGroup {
  targetType: ReportTarget;
  targetId: string;
  openCount: number;
  reasons: { reason: ReportReason; count: number }[];
  notes: string[];
  lastReportedAt: string;
  preview: TargetPreview;
  /** True while the target is hidden because reports hid it, not an admin. These come first. */
  autoHidden: boolean;
}

export interface ReportQueue {
  groups: ReportGroup[];
}

/** GET /api/admin/hidden: everything hidden now, and every banned member. */
export interface HiddenItem {
  targetType: ReportTarget;
  targetId: string;
  createdAt: string;
  preview: TargetPreview;
  autoHidden: boolean;
  /** False for photos: their bytes are deleted when they are hidden, so they cannot come back. */
  restorable: boolean;
}

export interface BannedMember {
  id: string;
  pseudonym: string;
  bannedAt: string;
}

export interface HiddenList {
  items: HiddenItem[];
  banned: BannedMember[];
}

/**
 * hide: hide now (a photo's bytes are deleted). restore: show again (not for photos).
 * dismiss: close the reports; an item that reports hid automatically is shown again.
 */
export type ModerationAction = 'hide' | 'restore' | 'dismiss';

/** POST /api/admin/moderate */
export interface ModerateBody {
  targetType: ReportTarget;
  targetId: string;
  action: ModerationAction;
}

export interface AdminClaim {
  id: string;
  code: string;
  status: 'pending' | 'approved' | 'rejected' | 'revoked';
  createdAt: string;
  decidedAt: string | null;
  claimant: { id: string; pseudonym: string };
  listing: { id: string; name: string; slug: string; kind: 'place' | 'product' | 'service'; ownerRun: boolean };
}

export interface ClaimQueue {
  claims: AdminClaim[];
}

export interface AdminListing {
  id: string;
  kind: 'place' | 'product' | 'service';
  name: string;
  slug: string;
  area: string | null;
  hidden: boolean;
  ownerRun: boolean;
  recommendations: number;
  opinions: number;
  createdAt: string;
}

export interface AdminListings {
  listings: AdminListing[];
}

/** POST /api/admin/listings/merge. The loser is hidden; everything members wrote moves to the survivor. */
export interface MergeBody {
  survivorId: string;
  loserId: string;
}

export interface MergeResult {
  moved: { recommendations: number; opinions: number; bookmarks: number; replies: number; topics: number };
}

export interface AuditRow {
  id: string;
  action: string;
  actor: string | null;
  targetType: string | null;
  targetId: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface AuditPage {
  rows: AuditRow[];
  /** Pass as ?before= to load older rows. */
  next: string | null;
}
