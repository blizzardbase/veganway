// The Admin tabs. Plain lists, one tap actions, a toast after each.
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ClipboardCheck, EyeOff, Flag, History, Search as SearchIcon } from 'lucide-react';
import { Button, Card, EmptyState, Field, Tag, useToast } from '../../ui';
import { Skeleton } from '../../ui/Skeleton';
import { errorMessage } from '../../api/client';
import {
  useAdminListings, useAuditLog, useBan, useClaimDecision, useClaimQueue, useHiddenList, useMerge, useModerate, usePin, useReportQueue,
  useRevokeOwner, useUnban,
} from './api';
import {
  REPORT_REASON_LABELS, type AdminListing, type HiddenItem, type ModerationAction, type ReportGroup, type TargetPreview,
} from '../../../shared/types/admin';

const TARGET_LABEL: Record<ReportGroup['targetType'], string> = {
  listing: 'Listing', recommendation: 'Recommendation', topic: 'Topic', reply: 'Reply', photo: 'Photo', user: 'Member',
};

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function Loading() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-3">
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
    </div>
  );
}

function RequestError({ query }: { query: { isError: boolean; error: unknown; isFetching: boolean; refetch: () => Promise<unknown> } }) {
  if (!query.isError) return null;
  return <div role="alert" className="flex flex-col gap-2 rounded-card border border-danger p-3">
    <p className="text-sm">Could not load this section. {errorMessage(query.error)}</p>
    <Button size="md" variant="secondary" disabled={query.isFetching} onClick={() => void query.refetch()}>Retry</Button>
  </div>;
}

function More({ query }: { query: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => Promise<unknown> } }) {
  return query.hasNextPage ? <Button variant="secondary" block busy={query.isFetchingNextPage} busyLabel="Loading" onClick={() => void query.fetchNextPage()}>Load more</Button> : null;
}

/** Wraps a mutation call with a success toast and an error toast. */
function useRun() {
  const toast = useToast();
  return async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast.show({ message: done });
    } catch (err) {
      toast.show({ message: errorMessage(err) });
    }
  };
}

/** The title of a reported or hidden thing, linked to its page when it has one. */
function PreviewTitle({ preview }: { preview: TargetPreview }) {
  return (
    <p className="text-base font-bold break-words">
      {preview.path && !preview.path.startsWith('/media/')
        ? <Link to={preview.path} className="inline-flex min-h-11 items-center underline">{preview.title}</Link>
        : preview.title}
    </p>
  );
}

// ---------- Reports ----------

function ReportCard({ g }: { g: ReportGroup }) {
  const moderate = useModerate();
  const ban = useBan();
  const pin = usePin();
  const run = useRun();
  const act = (action: ModerationAction, done: string) =>
    run(() => moderate.mutateAsync({ targetType: g.targetType, targetId: g.targetId, action }), done);
  const busy = moderate.isPending || ban.isPending || pin.isPending;
  const authorId = g.preview.authorId;
  const [confirming, setConfirming] = useState<'photo' | 'ban' | null>(null);

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone="plain">{TARGET_LABEL[g.targetType]}</Tag>
        <Tag tone="saffron">{g.openCount} {g.openCount === 1 ? 'report' : 'reports'}</Tag>
        {g.autoHidden ? <Tag tone="saffron">Auto hidden</Tag> : g.preview.hidden && <Tag>Hidden</Tag>}
      </div>
      <PreviewTitle preview={g.preview} />
      {g.targetType === 'photo' && g.preview.path && <img src={g.preview.path} alt="Reported photo" className="h-32 w-full rounded-input object-cover" />}
      {g.preview.excerpt && <p className="text-sm break-words">{g.preview.excerpt}</p>}
      <p className="text-xs text-muted">
        {g.preview.author && <>By {g.preview.author} · </>}
        {g.reasons.map((r) => `${REPORT_REASON_LABELS[r.reason]} (${r.count})`).join(', ')} · last {when(g.lastReportedAt)}
      </p>
      {g.notes.map((n, i) => <p key={i} className="rounded-input bg-surface-2 px-3 py-2 text-sm break-words">{n}</p>)}
      <div className="flex flex-wrap gap-2 pt-1">
        {g.preview.hidden
          ? (g.targetType !== 'photo' || g.autoHidden) && <Button size="md" variant="secondary" disabled={busy} onClick={() => void act('restore', 'Restored.')}>Restore</Button>
          : <Button size="md" disabled={busy} onClick={() => g.targetType === 'photo' ? setConfirming('photo') : void act('hide', 'Hidden.')}>Hide</Button>}
        {g.targetType === 'photo' && g.autoHidden && <Button size="md" disabled={busy} onClick={() => setConfirming('photo')}>Hide</Button>}
        <Button size="md" variant="secondary" disabled={busy} onClick={() => void act('dismiss', g.autoHidden ? 'Reports dismissed. It shows again.' : 'Reports dismissed.')}>Dismiss</Button>
        {g.targetType === 'topic' && (
          <Button size="md" variant="ghost" disabled={busy} onClick={() => void run(() => pin.mutateAsync({ id: g.targetId, pinned: true }), 'Pinned.')}>Pin</Button>
        )}
        {authorId && (
          <Button size="md" variant="danger" disabled={busy} onClick={() => setConfirming('ban')}>
            Ban {g.targetType === 'user' ? 'member' : 'author'}
          </Button>
        )}
      </div>
      {confirming && <div role="group" aria-label="Confirm permanent action" className="flex flex-col gap-2 rounded-input border border-danger p-3">
        <p className="text-sm font-bold">{confirming === 'photo' ? `Hide ${g.preview.title}?` : `Ban ${g.preview.author ?? g.preview.title}, author of ${g.preview.title}?`}</p>
        <p className="text-sm">{confirming === 'photo' ? 'This deletes the photo. The photos cannot come back.' : 'This hides their posts and deletes all their photos. The photos cannot come back after unbanning.'}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="md" variant="danger" disabled={busy} onClick={() => {
            if (confirming === 'photo') void act('hide', 'Hidden.');
            else if (authorId) void run(() => ban.mutateAsync(authorId), 'Member banned. Their posts are hidden.');
            setConfirming(null);
          }}>{confirming === 'photo' ? 'Yes, hide photo' : 'Yes, ban author'}</Button>
          <Button size="md" variant="secondary" disabled={busy} onClick={() => setConfirming(null)}>Cancel</Button>
        </div>
      </div>}
    </Card>
  );
}

export function ReportsTab() {
  const query = useReportQueue(true);
  if (query.isPending) return <Loading />;
  const groups = query.data?.pages.flatMap(p => p.groups) ?? [];
  return <div className="flex flex-col gap-3">
    <RequestError query={query} />
    {!groups.length && !query.isError && <EmptyState icon={Flag} line="No open reports. All clear." />}
    {groups.map(g => <ReportCard key={`${g.targetType}:${g.targetId}`} g={g} />)}
    <More query={query} />
  </div>;
}

// ---------- Hidden ----------

function HiddenCard({ item }: { item: HiddenItem }) {
  const moderate = useModerate();
  const run = useRun();
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone="plain">{TARGET_LABEL[item.targetType]}</Tag>
        {item.autoHidden && <Tag tone="saffron">Auto hidden</Tag>}
      </div>
      <PreviewTitle preview={item.preview} />
      {item.preview.excerpt && <p className="text-sm break-words">{item.preview.excerpt}</p>}
      <p className="text-xs text-muted">{item.preview.author && <>By {item.preview.author} · </>}added {when(item.createdAt)}</p>
      {item.restorable ? (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            size="md"
            variant="secondary"
            disabled={moderate.isPending}
            onClick={() => void run(() => moderate.mutateAsync({ targetType: item.targetType, targetId: item.targetId, action: 'restore' }), 'Restored.')}
          >
            Restore
          </Button>
        </div>
      ) : (
        <div className="text-sm text-muted">
          <p>This photo cannot come back.</p>
          <p>{item.deletion?.pending ? `Byte deletion pending. ${item.deletion.attempts} attempts. ${item.deletion.error ? 'Storage could not confirm deletion.' : ''}` : 'Photo bytes deleted.'}</p>
        </div>
      )}
    </Card>
  );
}

function HiddenQueue({ section, title }: { section: 'items' | 'photos' | 'banned'; title: string }) {
  const query = useHiddenList(true, section);
  const unban = useUnban();
  const run = useRun();
  const items = query.data?.pages.flatMap(p => p.items) ?? [];
  const banned = query.data?.pages.flatMap(p => p.banned) ?? [];
  return <section className="flex flex-col gap-3" aria-label={title}>
    <h2 className="text-lg font-extrabold">{title}</h2>
    <RequestError query={query} />
    {query.isPending ? <Loading /> : <>
      {section === 'banned' ? <>
        {!banned.length && !query.isError && <p className="text-base text-muted">No banned members.</p>}
        {banned.map(m => <Card key={m.id} className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 break-words"><span className="font-bold">{m.pseudonym}</span><span className="block text-xs text-muted">Banned {when(m.bannedAt)}</span></span>
          <Button size="md" variant="secondary" disabled={unban.isPending} onClick={() => void run(() => unban.mutateAsync(m.id), 'Unbanned. Their posts stay hidden until you restore them.')}>Unban</Button>
        </Card>)}
      </> : <>
        {!items.length && !query.isError && <EmptyState icon={EyeOff} line={section === 'photos' ? 'No hidden photos.' : 'Nothing is hidden.'} />}
        {items.map(item => <HiddenCard key={`${item.targetType}:${item.targetId}`} item={item} />)}
        {section === 'photos' && items.some(item => item.deletion?.pending) && <Button variant="secondary" disabled={query.isFetching} onClick={() => void query.refetch()}>Retry photo deletions</Button>}
      </>}
      <More query={query} />
    </>}
  </section>;
}

export function HiddenSection() {
  return <div className="flex flex-col gap-6">
    <HiddenQueue section="items" title="Hidden" />
    <HiddenQueue section="banned" title="Banned members" />
    <HiddenQueue section="photos" title="Hidden photos and deletion history" />
  </div>;
}

// ---------- Claims ----------

export function ClaimsTab() {
  const [all, setAll] = useState(false);
  const query = useClaimQueue(true, all);
  const claims = query.data?.pages.flatMap(p => p.claims) ?? [];
  const decide = useClaimDecision();
  const run = useRun();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">Approve only when the owner sent you the same code on WhatsApp from the number the group knows.</p>
      <label className="flex h-11 items-center gap-2 text-sm font-bold">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="size-5 accent-ink" />
        Show decided claims too
      </label>
      {query.isPending ? <Loading /> : <>
        <RequestError query={query} />
        {!claims.length && !query.isError && <EmptyState icon={ClipboardCheck} line="No claims waiting." />}
        {claims.map((c) => (
          <Card key={c.id} className="flex flex-col gap-2">
            <p data-testid="admin-claim-code" className="font-mono text-2xl font-extrabold tracking-widest">{c.code}</p>
            <p className="text-base break-words">
              <span className="font-bold">{c.claimant.pseudonym}</span> claims{' '}
              <Link className="inline-flex min-h-11 items-center font-bold text-ink underline" to={`/${c.listing.kind === 'service' ? 'services' : c.listing.kind === 'product' ? 'products' : 'places'}/${c.listing.slug}`}>{c.listing.name}</Link>
            </p>
            <p className="text-xs text-muted">{when(c.createdAt)} · {c.status}</p>
            <div className="flex flex-wrap gap-2">
              {c.status === 'pending' && (
                <>
                  <Button size="md" disabled={decide.isPending} onClick={() => void run(() => decide.mutateAsync({ id: c.id, decision: 'approve' }), 'Approved. They now run this listing.')}>Approve</Button>
                  <Button size="md" variant="secondary" disabled={decide.isPending} onClick={() => void run(() => decide.mutateAsync({ id: c.id, decision: 'reject' }), 'Rejected.')}>Reject</Button>
                </>
              )}
              {c.status === 'approved' && (
                <Button size="md" variant="danger" disabled={decide.isPending} onClick={() => void run(() => decide.mutateAsync({ id: c.id, decision: 'revoke' }), 'Ownership revoked.')}>Revoke ownership</Button>
              )}
            </div>
          </Card>
        ))}
        <More query={query} />
      </>}
    </div>
  );
}

// ---------- Listings ----------

function ListingRow({ l, picked, onPick }: { l: AdminListing; picked: 'survivor' | 'loser' | null; onPick: (role: 'survivor' | 'loser') => void }) {
  const revoke = useRevokeOwner();
  const run = useRun();
  return (
    <li className="flex flex-col gap-2 border-b border-line py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 font-bold break-words">{l.name}</span>
        <Tag tone="plain">{l.kind}</Tag>
        {l.hidden && <Tag>Hidden</Tag>}
        {l.ownerRun && <Tag tone="saffron">Owned</Tag>}
      </div>
      <p className="text-xs text-muted">{l.area ?? 'No area'} · {l.recommendations} recommendations · {l.opinions} votes · {when(l.createdAt)}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="md" variant={picked === 'survivor' ? 'primary' : 'secondary'} onClick={() => onPick('survivor')}>Keep this one</Button>
        <Button size="md" variant={picked === 'loser' ? 'primary' : 'secondary'} onClick={() => onPick('loser')}>Merge into the kept one</Button>
        {l.ownerRun && (
          <Button size="md" variant="danger" disabled={revoke.isPending} onClick={() => void run(() => revoke.mutateAsync(l.id), 'Ownership revoked.')}>Revoke owner</Button>
        )}
      </div>
    </li>
  );
}

export function ListingsTab() {
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [survivor, setSurvivor] = useState<AdminListing | null>(null);
  const [loser, setLoser] = useState<AdminListing | null>(null);
  const query = useAdminListings(true, q);
  const { data, isPending } = query;
  const merge = useMerge();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    setQ(input.trim());
  };
  const pick = (l: AdminListing, role: 'survivor' | 'loser') => {
    setConfirming(false);
    if (role === 'survivor') {
      setSurvivor(l);
      if (loser?.id === l.id) setLoser(null);
    } else {
      setLoser(l);
      if (survivor?.id === l.id) setSurvivor(null);
    }
  };
  const doMerge = async () => {
    if (!survivor || !loser) return;
    try {
      const res = await merge.mutateAsync({ survivorId: survivor.id, loserId: loser.id });
      const m = res.moved;
      toast.show({ message: `Merged. Moved ${m.recommendations} recommendations, ${m.opinions} votes, ${m.replies} replies.` });
      setSurvivor(null);
      setLoser(null);
      setConfirming(false);
    } catch (err) {
      toast.show({ message: errorMessage(err) });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <form role="search" className="flex items-end gap-2" onSubmit={onSearch}>
        <Field label="Find listings" className="flex-1" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Name" />
        <Button type="submit" size="lg" icon={<SearchIcon size={18} aria-hidden="true" />}>Find</Button>
      </form>

      {(survivor || loser) && (
        <Card className="flex flex-col gap-2 border-ink">
          <p className="text-sm">Keep: <span className="font-bold">{survivor?.name ?? 'pick one'}</span></p>
          <p className="text-sm">Merge and hide: <span className="font-bold">{loser?.name ?? 'pick one'}</span></p>
          {survivor && loser && (confirming ? (
            <div className="flex flex-wrap gap-2">
              <Button size="md" busy={merge.isPending} busyLabel="Merging" onClick={() => void doMerge()}>Yes, merge now</Button>
              <Button size="md" variant="secondary" onClick={() => setConfirming(false)}>Cancel</Button>
            </div>
          ) : (
            <Button size="md" onClick={() => setConfirming(true)}>Merge</Button>
          ))}
        </Card>
      )}

      <RequestError query={query} />
      {isPending ? <Loading /> : !data?.listings.length ? !query.isError && <p className="text-base text-muted">No listings match.</p> : (
        <ul className="flex flex-col">
          {data.listings.map((l) => (
            <ListingRow key={l.id} l={l} picked={survivor?.id === l.id ? 'survivor' : loser?.id === l.id ? 'loser' : null} onPick={(role) => pick(l, role)} />
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- Audit ----------

export function AuditTab() {
  const query = useAuditLog(true);
  const { data, isPending, fetchNextPage, hasNextPage, isFetchingNextPage } = query;
  if (isPending) return <Loading />;
  const rows = data?.pages.flatMap((p) => p.rows) ?? [];

  return (
    <div className="flex flex-col gap-2">
      <RequestError query={query} />
      {!rows.length && !query.isError && <EmptyState icon={History} line="Nothing in the audit log yet." />}
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-col gap-1 border-b border-line py-2 last:border-0">
            <span className="font-mono text-sm font-bold">{r.action}</span>
            <span className="text-xs text-muted break-all">
              {r.actor ?? 'System'} · {when(r.createdAt)}{r.targetType ? ` · ${r.targetType} ${r.targetId ?? ''}` : ''}
            </span>
          </li>
        ))}
      </ul>
      {hasNextPage && <Button variant="secondary" block busy={isFetchingNextPage} busyLabel="Loading" onClick={() => void fetchNextPage()}>Load more</Button>}
    </div>
  );
}
