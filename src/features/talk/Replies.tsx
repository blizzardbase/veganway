// A reply thread with one level of nesting, upvotes, and a composer: sticky at the bottom of a topic,
// inline at the end of the thread on listing pages (where the opinion bar is the sticky element).
// Reusable: <Replies targetType="listing" targetId={id} /> on listing and service pages,
// <Replies targetType="topic" targetId={id} /> on a topic.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Flag, MessageCircle, Reply as ReplyIcon, SendHorizontal, Trash2, X } from 'lucide-react';
import { REPLY_MAX, type Reply, type ReplyTargetType } from '../../../shared/types/talk';
import { api, errorMessage } from '../../api/client';
import { useUser } from '../../api/session';
import { Avatar, ButtonLink, IconButton, InlineEmpty, INPUT_FOCUS, Skeleton, Tag, useToast } from '../../ui';
import { cx } from '../../lib/cx';
import { useRequireAccount, joinPath } from '../auth/Gate';
import { talkKeys, useCreateReply, useReplies, useReplyUpvote } from './api';
import { age, draftStore } from './format';
import { ReportSheet, type ReportTarget } from './ReportSheet';
import { UpvoteButton } from './UpvoteButton';
import { useLocation } from 'react-router';

export interface RepliesProps {
  targetType: ReplyTargetType;
  targetId: string;
  /** Heading above the thread. Default "Replies". */
  title?: string;
  /** Sticky at the bottom of the screen (topics, the default) or in the page flow (listing pages). */
  composer?: 'sticky' | 'inline';
}

const DELETE_DELAY = 4000;

export function Replies({ targetType, targetId, title = 'Replies', composer = 'sticky' }: RepliesProps) {
  const { data, isPending, isError, refetch } = useReplies(targetType, targetId);
  const upvote = useReplyUpvote(targetType, targetId);
  const requireAccount = useRequireAccount();
  const qc = useQueryClient();
  const toast = useToast();
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  const [report, setReport] = useState<ReportTarget | null>(null);
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // A delete waits a few seconds so Undo can cancel it. Leaving the page sends it at once.
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const [id, timer] of map) {
        clearTimeout(timer);
        void api.delete(`/api/talk/replies/${id}`).finally(() => qc.invalidateQueries({ queryKey: talkKeys.all }));
      }
      map.clear();
    };
  }, [qc]);

  const commitDelete = async (id: string) => {
    timers.current.delete(id);
    try {
      await api.delete(`/api/talk/replies/${id}`);
    } catch (err) {
      toast.show({ message: errorMessage(err) });
    }
    await qc.invalidateQueries({ queryKey: talkKeys.replies(targetType, targetId) });
    if (targetType === 'topic') await qc.invalidateQueries({ queryKey: talkKeys.topic(targetId) });
    setPending((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  };

  const remove = (id: string) => {
    setPending((s) => new Set(s).add(id));
    timers.current.set(id, setTimeout(() => void commitDelete(id), DELETE_DELAY));
    toast.show({
      message: 'Reply deleted',
      duration: DELETE_DELAY,
      onUndo: () => {
        const timer = timers.current.get(id);
        if (timer) clearTimeout(timer);
        timers.current.delete(id);
        setPending((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
      },
    });
  };

  const total = data ? data.total - [...pending].length : 0;

  const item = (r: Reply, nested: boolean) => (
    <ReplyItem
      key={r.id}
      reply={r}
      nested={nested}
      deleted={r.deleted || pending.has(r.id)}
      onUpvote={() => requireAccount(() => upvote.mutate(r.id))}
      onReply={() => requireAccount(() => setReplyTo({ id: r.id, name: r.author?.name ?? 'this reply' }))}
      onDelete={() => remove(r.id)}
      onReport={() => requireAccount(() => setReport({ type: 'reply', id: r.id }))}
    />
  );

  return (
    <section aria-labelledby={`replies-${targetId}`} className="flex flex-col gap-3">
      <h2 id={`replies-${targetId}`} className="text-lg font-extrabold">
        {title}
        {data && total > 0 && <span className="ml-2 text-base font-bold text-muted">{total}</span>}
      </h2>
      {isPending && (
        <div role="status" aria-label="Loading replies" className="flex flex-col gap-4">
          {[0, 1].map((i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="size-8 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            </div>
          ))}
        </div>
      )}
      {isError && (
        <p className="text-sm text-muted">
          Replies did not load. <button type="button" className="h-11 font-bold text-brand underline" onClick={() => void refetch()}>Try again</button>
        </p>
      )}
      {data && data.items.length === 0 && (
        <InlineEmpty icon={MessageCircle} line="No replies yet. Be the first." />
      )}
      {data && data.items.length > 0 && (
        <ul className="flex flex-col gap-4" data-testid="reply-thread">
          {data.items.map((thread) => (
            <li key={thread.id} className="flex flex-col gap-3">
              {item(thread, false)}
              {thread.replies.length > 0 && (
                <ul className="ml-4 flex flex-col gap-3 border-l-2 border-line pl-3">
                  {thread.replies.map((child) => <li key={child.id}>{item(child, true)}</li>)}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      <Composer
        targetType={targetType}
        targetId={targetId}
        sticky={composer === 'sticky'}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onSent={() => setReplyTo(null)}
      />
      <ReportSheet target={report} onClose={() => setReport(null)} />
    </section>
  );
}

function ReplyItem({ reply, nested, deleted, onUpvote, onReply, onDelete, onReport }: {
  reply: Reply;
  nested: boolean;
  deleted: boolean;
  onUpvote: () => void;
  onReply: () => void;
  onDelete: () => void;
  onReport: () => void;
}) {
  if (deleted) {
    return (
      <div className="flex items-center gap-3 py-1 text-sm text-muted italic" data-testid="reply">
        <span aria-hidden="true" className="size-8 shrink-0 rounded-full bg-surface-2" />
        Deleted
      </div>
    );
  }
  const name = reply.author?.name ?? 'Member';
  return (
    <article className="flex gap-3" data-testid="reply">
      <Avatar name={name} size="sm" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
          <span className="font-bold text-ink">{name}</span>
          <time dateTime={reply.createdAt}>{age(reply.createdAt)}</time>
          {reply.hidden && <Tag tone="plain">Hidden</Tag>}
        </p>
        <p className="text-base break-words whitespace-pre-line">{reply.body}</p>
        <div className="-ml-3 flex items-center gap-0.5">
          <UpvoteButton count={reply.upvotes} upvoted={reply.upvoted} onToggle={onUpvote} label="Upvote reply" />
          <button type="button" onClick={onReply} className="inline-flex h-11 items-center gap-1 rounded-full px-3 text-sm font-bold text-muted hover:bg-surface-2 hover:text-ink">
            <ReplyIcon size={16} aria-hidden="true" /> Reply
            {nested && <span className="sr-only"> to {name}</span>}
          </button>
          {reply.mine
            ? <IconButton label="Delete reply" onClick={onDelete} className="text-muted"><Trash2 size={18} aria-hidden="true" /></IconButton>
            : <IconButton label="Report reply" onClick={onReport} className="text-muted"><Flag size={18} aria-hidden="true" /></IconButton>}
        </div>
      </div>
    </article>
  );
}

function Composer({ targetType, targetId, sticky, replyTo, onCancelReply, onSent }: {
  targetType: ReplyTargetType;
  targetId: string;
  sticky: boolean;
  replyTo: { id: string; name: string } | null;
  onCancelReply: () => void;
  onSent: () => void;
}) {
  const user = useUser();
  const location = useLocation();
  const key = `vw-draft:${targetType}:${targetId}`;
  const [text, setText] = useState(() => draftStore.get(key));
  const create = useCreateReply(targetType, targetId);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (replyTo) ref.current?.focus();
  }, [replyTo]);

  // Grow with the text, up to about six lines.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const change = (value: string) => {
    setText(value);
    draftStore.set(key, value);
    if (create.isError) create.reset();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || create.isPending) return;
    create.mutate({ body, parentId: replyTo?.id ?? null }, {
      onSuccess: () => {
        setText('');
        draftStore.set(key, '');
        onSent();
      },
    });
  };

  const over = text.length > REPLY_MAX;

  return (
    <div
      data-testid="reply-composer"
      className={sticky
        ? 'fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[var(--safe-bottom)] backdrop-blur'
        : 'rounded-card border border-line bg-surface'}
    >
      <div className={sticky ? 'mx-auto w-full max-w-[560px] px-4 py-2' : 'p-2'}>
        {user === null ? (
          <ButtonLink to={joinPath(location.pathname + location.search)} variant="secondary" size="md" block>Join to reply</ButtonLink>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-1">
            {replyTo && (
              <p className="flex items-center gap-1 text-xs font-semibold text-muted">
                Replying to {replyTo.name}
                <IconButton label="Cancel reply" onClick={onCancelReply} className="-my-3 size-11"><X size={16} aria-hidden="true" /></IconButton>
              </p>
            )}
            <div className="flex items-end gap-2">
              <label htmlFor={`composer-${targetId}`} className="sr-only">Write a reply</label>
              <textarea
                id={`composer-${targetId}`}
                ref={ref}
                rows={1}
                value={text}
                onChange={(e) => change(e.target.value)}
                placeholder="Write a reply"
                aria-invalid={over || create.isError || undefined}
                className={cx(
                  'max-h-40 min-h-11 flex-1 resize-none rounded-input border bg-surface px-4 py-2.5 text-base text-ink placeholder:text-muted',
                  INPUT_FOCUS,
                  over || create.isError ? 'border-danger' : 'border-line',
                )}
              />
              <IconButton
                type="submit"
                label="Send reply"
                disabled={!text.trim() || over || create.isPending}
                className="bg-brand text-on-brand hover:bg-brand disabled:opacity-40"
              >
                <SendHorizontal size={20} aria-hidden="true" />
              </IconButton>
            </div>
            {over && <p className="text-xs font-semibold text-danger">Keep your reply under {REPLY_MAX} characters.</p>}
            {create.isError && <p role="alert" className="text-xs font-semibold text-danger">{errorMessage(create.error)}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
