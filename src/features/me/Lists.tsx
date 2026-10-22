// My posts on the Me screen. Saved comes from the Listings slice (SavedList).
import { Link } from 'react-router';
import { ChevronRight, PenLine } from 'lucide-react';
import { InlineEmpty, Monogram, Skeleton, Tag } from '../../ui';
import type { MyPosts } from '../../../shared/types/me';

export function listingPath(kind: 'place' | 'product' | 'service', slug: string): string {
  return `/${kind === 'service' ? 'services' : kind === 'product' ? 'products' : 'places'}/${slug}`;
}

function Row({ to, title, sub, hidden, mono }: { to: string; title: string; sub?: string; hidden?: boolean; mono?: { name: string; category?: string } }) {
  return (
    <li>
      <Link to={to} className="flex min-h-14 items-center gap-3 rounded-input px-2 py-2 hover:bg-surface-2">
        {mono && <Monogram name={mono.name} category={mono.category} size="sm" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-bold">{title}</span>
          {sub && <span className="block truncate text-sm text-muted">{sub}</span>}
        </span>
        {hidden && <Tag tone="plain">Hidden</Tag>}
        <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-muted" />
      </Link>
    </li>
  );
}

export function PostsList({ posts, loading, failed }: { posts: MyPosts | undefined; loading: boolean; failed: boolean }) {
  if (loading) return <Skeleton className="h-14" />;
  const total = posts ? posts.listings.length + posts.recommendations.length + posts.topics.length + posts.replies.length : 0;
  if (!posts || total === 0) return failed ? null : <InlineEmpty artwork="posts" icon={PenLine} line="You have not posted yet. Your places, recommendations and replies show here." />;
  return (
    <ul className="flex flex-col">
      {posts.listings.map((x) => <Row key={`l${x.id}`} to={listingPath(x.kind, x.slug)} title={x.name} sub={`Added a ${x.kind}`} hidden={x.hidden} />)}
      {posts.recommendations.map((x) => <Row key={`r${x.id}`} to={listingPath(x.listing.kind, x.listing.slug)} title={x.body} sub={`Recommendation on ${x.listing.name}`} hidden={x.hidden} />)}
      {posts.topics.map((x) => <Row key={`t${x.id}`} to={`/talk/${x.id}`} title={x.title} sub={x.kind === 'poll' ? 'Poll' : 'Discussion'} hidden={x.hidden} />)}
      {posts.replies.map((x) => (
        <Row
          key={`p${x.id}`}
          to={x.on?.type === 'topic' ? `/talk/${x.on.id}` : x.on?.type === 'listing' ? listingPath(x.on.kind, x.on.slug) : '/me'}
          title={x.body}
          sub={x.on ? `Reply on ${x.on.type === 'topic' ? x.on.title : x.on.name}` : 'Reply'}
          hidden={x.hidden}
        />
      ))}
    </ul>
  );
}
