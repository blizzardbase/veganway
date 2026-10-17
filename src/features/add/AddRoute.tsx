// /add/:kind renders the slice owned form for that kind. Slices edit their form files, not this one.
import { lazy, Suspense } from 'react';
import { useParams } from 'react-router';
import { RequireAccount } from '../auth/Gate';
import { ListSkeleton } from '../../ui/Skeleton';
import { NotFound } from '../../screens/NotFound';
import type { AddKind } from './AddSheet';

const FORMS: Record<AddKind, ReturnType<typeof lazy>> = {
  place: lazy(() => import('../listings/AddPlaceForm')),
  product: lazy(() => import('../listings/AddProductForm')),
  offer: lazy(() => import('../listings/AddOfferForm')),
  service: lazy(() => import('../services/AddServiceForm')),
  discussion: lazy(() => import('../talk/AddDiscussionForm')),
  poll: lazy(() => import('../talk/AddPollForm')),
};

export function AddRoute() {
  const { kind } = useParams();
  const Form = kind && kind in FORMS ? FORMS[kind as AddKind] : null;
  if (!Form) return <NotFound />;
  return (
    <RequireAccount>
      <Suspense fallback={<div className="pt-4"><ListSkeleton count={2} /></div>}>
        <Form />
      </Suspense>
    </RequireAccount>
  );
}
