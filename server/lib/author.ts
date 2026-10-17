// The one public projection of a member as an author. Every public read that shows who wrote
// something uses these columns, so the rules live in one place:
//   a deleted account reads "Former member" with no name or photo;
//   a hidden profile (users.profile_hidden, set by an admin or by reports) shows only the pseudonym.
import { mediaUrl } from '../routes/photos.js';
import type { Author } from '../../shared/types/listings.js';

/** SQL columns for an author from users alias u and avatar photo alias ap, each prefixed. */
export const authorCols = (u: string, ap: string, prefix: string) => `
  CASE WHEN ${u}.deleted_at IS NOT NULL THEN 'Former member' ELSE ${u}.pseudonym END AS ${prefix}pseudonym,
  CASE WHEN ${u}.deleted_at IS NULL AND NOT ${u}.profile_hidden THEN ${u}.display_name END AS ${prefix}display_name,
  CASE WHEN ${u}.deleted_at IS NULL AND NOT ${u}.profile_hidden THEN ${ap}.blob_path END AS ${prefix}avatar_path`;

export interface AuthorRow {
  a_pseudonym: string;
  a_display_name: string | null;
  a_avatar_path: string | null;
}

/** Use with authorCols(u, ap, 'a_'). */
export function toAuthor(r: AuthorRow): Author {
  return { pseudonym: r.a_pseudonym, displayName: r.a_display_name, avatarUrl: r.a_avatar_path ? mediaUrl(r.a_avatar_path) : null };
}
