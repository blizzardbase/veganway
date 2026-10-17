// Slots for the Talk slice's components on a listing page:
//   src/features/talk/Replies.tsx       <Replies targetType="listing" targetId={id} />
//   src/features/talk/LinkedTopics.tsx  <LinkedTopics listingId={id} listingName listingSlug listingKind />
// They are loaded through import.meta.glob, so this slice builds whether or not the Talk files
// exist yet; once they do, Vite bundles them here with no change to this file.
import { lazy, Suspense, type ComponentType } from 'react';
import { Skeleton } from '../../ui';
import type { ListingKind } from '../../../shared/types/listings';

type Loader = () => Promise<Record<string, unknown>>;
const modules = import.meta.glob(['../talk/Replies.tsx', '../talk/LinkedTopics.tsx']) as Record<string, Loader>;

function slot<P>(path: string, exportName: string): ComponentType<P> | null {
  const load = modules[path];
  if (!load) return null;
  return lazy(async () => {
    const mod = await load();
    const component = (mod[exportName] ?? mod.default) as ComponentType<P> | undefined;
    return { default: component ?? (() => null) };
  });
}

interface RepliesProps { targetType: 'listing' | 'topic'; targetId: string; composer?: 'sticky' | 'inline' }
interface LinkedTopicsProps { listingId: string; listingName?: string; listingSlug?: string; listingKind?: ListingKind }

const Replies = slot<RepliesProps>('../talk/Replies.tsx', 'Replies');
const LinkedTopics = slot<LinkedTopicsProps>('../talk/LinkedTopics.tsx', 'LinkedTopics');

export function ListingTalk({ listingId, name, slug, kind }: { listingId: string; name: string; slug: string; kind: ListingKind }) {
  if (!Replies && !LinkedTopics) return null;
  return (
    <Suspense fallback={<Skeleton className="h-24 w-full rounded-card" />}>
      {LinkedTopics && <LinkedTopics listingId={listingId} listingName={name} listingSlug={slug} listingKind={kind} />}
      {Replies && <Replies targetType="listing" targetId={listingId} composer="inline" />}
    </Suspense>
  );
}
