// One topic in a list: title, first line, author, age, replies, upvotes, and an inline poll.
import { Link } from 'react-router';
import { MessageCircle, Pin } from 'lucide-react';
import type { TopicSummary } from '../../../shared/types/talk';
import { Card, Skeleton, Tag } from '../../ui';
import { useRequireAccount } from '../auth/Gate';
import { useTopicUpvote } from './api';
import { age } from './format';
import { replyCount } from '../../lib/counts';
import { PollBlock } from './PollBlock';
import { UpvoteButton } from './UpvoteButton';

export function TopicRow({ topic }: { topic: TopicSummary }) {
  const upvote = useTopicUpvote(topic.id);
  const requireAccount = useRequireAccount();
  const href = `/talk/${topic.id}`;
  return (
    <Card padded={false} className="flex flex-col gap-3 p-4" data-testid="topic-row">
      {(topic.pinned || topic.kind === 'poll' || topic.hidden) && (
        <div className="flex flex-wrap gap-1.5">
          {topic.pinned && <Tag tone="saffron"><Pin size={12} aria-hidden="true" />Pinned</Tag>}
          {topic.kind === 'poll' && <Tag>Poll</Tag>}
          {topic.hidden && <Tag tone="plain">Hidden</Tag>}
        </div>
      )}
      <Link to={href} className="-m-1 flex flex-col gap-1 rounded-input p-1">
        <h2 className="text-lg font-extrabold break-words">{topic.title}</h2>
        {topic.excerpt && <p className="line-clamp-2 text-sm text-muted break-words">{topic.excerpt}</p>}
      </Link>
      {topic.poll && <PollBlock topicId={topic.id} poll={topic.poll} compact />}
      <div className="-mb-2 -ml-3 flex items-center gap-1 text-sm text-muted">
        <UpvoteButton count={topic.upvotes} upvoted={topic.upvoted} onToggle={() => requireAccount(() => upvote.mutate())} />
        <Link
          to={href}
          aria-label={replyCount(topic.replyCount) ?? 'Reply'}
          className="inline-flex h-11 min-w-11 items-center justify-center gap-1 rounded-full px-3 font-bold hover:bg-surface-2 hover:text-ink"
        >
          <MessageCircle size={18} aria-hidden="true" />
          {topic.replyCount > 0 && <span className="tabular-nums">{topic.replyCount}</span>}
        </Link>
        <span className="ml-auto min-w-0 truncate text-xs">
          {topic.author.name} · <time dateTime={topic.createdAt}>{age(topic.createdAt)}</time>
        </span>
      </div>
    </Card>
  );
}

export function TopicRowSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
      <Skeleton className="h-5 w-4/5" />
      <Skeleton className="h-3 w-3/5" />
      <div className="flex gap-3 pt-1">
        <Skeleton className="h-6 w-12" />
        <Skeleton className="h-6 w-12" />
      </div>
    </div>
  );
}

export function TopicListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading discussions" className="flex flex-col gap-3">
      {Array.from({ length: count }, (_, i) => <TopicRowSkeleton key={i} />)}
    </div>
  );
}
