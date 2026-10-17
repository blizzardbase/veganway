// Add an offer: pick the listing, write the offer, choose the last day. An offer is a
// recommendation with an expiry, so it shows on the listing and in the Deals strip until then.
// Route: /add/offer (optionally ?listing=<slug>), signed in. Default export: AddRoute lazy loads it.
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Button, Chip, Field, StickyBar, TopBar, useToast } from '../../ui';
import { ApiError, errorMessage } from '../../api/client';
import { useCreateRecommendation, useListing } from './api';
import { ListingPicker } from './Typeahead';
import { OFFER_MAX, OFFER_MAX_DAYS, listingPath, type ListingSuggestion } from '../../../shared/types/listings';

type Errors = Partial<Record<'listing' | 'offer' | 'offerExpiresOn' | 'form', string>>;

/** Today in Dubai, plus n days, as YYYY-MM-DD. */
function dubaiDay(n = 0): string {
  return new Date(Date.now() + 4 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
}

const QUICK: { label: string; days: number }[] = [
  { label: '3 days', days: 3 },
  { label: '1 week', days: 7 },
  { label: '2 weeks', days: 14 },
  { label: '1 month', days: 30 },
];

export default function AddOfferForm() {
  const [params] = useSearchParams();
  const preset = params.get('listing');
  const presetQuery = useListing(preset ?? undefined);
  const [picked, setPicked] = useState<ListingSuggestion | null | undefined>(undefined);
  const [offer, setOffer] = useState('');
  const [until, setUntil] = useState(dubaiDay(7));
  const [errors, setErrors] = useState<Errors>({});
  const navigate = useNavigate();
  const toast = useToast();

  // The preset listing counts as picked until the member changes it.
  const fromPreset: ListingSuggestion | null = presetQuery.data
    ? {
      id: presetQuery.data.id, slug: presetQuery.data.slug, kind: presetQuery.data.kind, name: presetQuery.data.name,
      area: presetQuery.data.area, stores: presetQuery.data.stores, veganStatus: presetQuery.data.veganStatus,
    }
    : null;
  const listing = picked === undefined ? fromPreset : picked;
  const create = useCreateRecommendation(listing?.slug ?? '');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local: Errors = {};
    if (!listing) local.listing = 'Choose where the offer is.';
    if (offer.trim().length < 3) local.offer = 'Describe the offer.';
    if (!until || until < dubaiDay(0)) local.offerExpiresOn = 'Choose today or a later day.';
    else if (until > dubaiDay(OFFER_MAX_DAYS)) local.offerExpiresOn = `Offers can run for up to ${OFFER_MAX_DAYS} days.`;
    setErrors(local);
    if (Object.keys(local).length || !listing) return;
    try {
      await create.mutateAsync({ offer: offer.trim(), offerExpiresOn: until });
      toast.show({ message: 'Offer shared. Thank you.' });
      navigate(listingPath(listing), { replace: true });
    } catch (err) {
      const field = err instanceof ApiError ? err.field : undefined;
      const key = field === 'offer' || field === 'offerExpiresOn' ? field : 'form';
      setErrors({ [key]: errorMessage(err) });
    }
  };

  return (
    <>
      <TopBar title="Share an offer" back />
      <form onSubmit={submit} noValidate className="flex flex-col gap-6">
        <ListingPicker value={listing} onPick={setPicked} error={errors.listing} />
        <Field
          label="The offer"
          placeholder="For example: 20% off all cakes on Fridays"
          value={offer}
          maxLength={OFFER_MAX}
          onChange={(e) => setOffer(e.target.value)}
          error={errors.offer}
        />
        <div className="flex flex-col gap-2">
          <Field
            label="Last day of the offer"
            type="date"
            value={until}
            min={dubaiDay(0)}
            max={dubaiDay(OFFER_MAX_DAYS)}
            onChange={(e) => setUntil(e.target.value)}
            error={errors.offerExpiresOn}
          />
          <div className="flex flex-wrap gap-2" role="group" aria-label="Quick choices">
            {QUICK.map((q) => (
              <Chip key={q.days} selected={until === dubaiDay(q.days)} onClick={() => setUntil(dubaiDay(q.days))}>{q.label}</Chip>
            ))}
          </div>
        </div>
        <StickyBar>
          {errors.form && <p role="alert" className="text-sm font-semibold text-danger">{errors.form}</p>}
          <Button type="submit" block busy={create.isPending} busyLabel="Sharing">Share offer</Button>
        </StickyBar>
      </form>
    </>
  );
}
