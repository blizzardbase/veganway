// Add a place: name with a duplicate check, area, vegan status, then optional extras. Built to take
// about 20 seconds: popular areas are one tap, the rest are in a searchable sheet, and the primary
// button stays at the bottom of the screen (no tab bar on Add forms).
// Route: /add/place, signed in (RequireAccount). Default export: AddRoute lazy loads it.
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ChevronDown, ThumbsUp } from 'lucide-react';
import { Button, Chip, Field, StickyBar, TopBar, useToast } from '../../ui';
import { ApiError, errorMessage } from '../../api/client';
import { useCreateListing } from './api';
import { ChoiceChips } from './bits';
import { DuplicateHint } from './Typeahead';
import { PhotoPicker } from './PhotoPicker';
import { AreaSheet, POPULAR_AREAS } from './AreaSheet';
import {
  BODY_MAX, NAME_MAX, PLACE_CATEGORIES, VEGAN_STATUS_LABEL, VEGAN_STATUS_REQUIRED, listingPath, type PhotoResponse,
} from '../../../shared/types/listings';

type Status = 'fully_vegan' | 'vegan_options';
type Errors = Partial<Record<'name' | 'area' | 'veganStatus' | 'whatToOrder' | 'mapsUrl' | 'form', string>>;


export default function AddPlaceForm() {
  const navigate = useNavigate();
  const toast = useToast();
  const create = useCreateListing();
  const [name, setName] = useState('');
  const [area, setArea] = useState<string | null>(null);
  const [areaSheet, setAreaSheet] = useState(false);
  const [status, setStatus] = useState<Status[]>([]);
  const [category, setCategory] = useState<string[]>([]);
  // Nothing is preselected under an "(optional)" heading; recommending stays one tap.
  const [recommend, setRecommend] = useState(false);
  const [whatToOrder, setWhatToOrder] = useState('');
  const [mapsUrl, setMapsUrl] = useState('');
  const [photo, setPhoto] = useState<PhotoResponse | null>(null);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<Errors>({});

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local: Errors = {};
    if (name.trim().length < 2) local.name = 'Enter the name of the place.';
    if (!area) local.area = 'Choose an area.';
    if (!status[0]) local.veganStatus = VEGAN_STATUS_REQUIRED;
    if (mapsUrl.trim() && !/^https:\/\//i.test(mapsUrl.trim())) local.mapsUrl = 'Paste the full link, starting with https.';
    setErrors(local);
    if (Object.keys(local).length || !area) return;
    try {
      const { listing } = await create.mutateAsync({
        kind: 'place',
        name: name.trim(),
        area,
        veganStatus: status[0],
        category: category[0],
        whatToOrder: whatToOrder.trim() || undefined,
        opinion: recommend ? 'recommend' : null,
        mapsUrl: mapsUrl.trim() || undefined,
        photoId: photo?.id,
      });
      toast.show({ message: 'Added. Thank you for sharing.' });
      navigate(listingPath(listing), { replace: true });
    } catch (err) {
      const field = err instanceof ApiError ? err.field : undefined;
      const key = field && ['name', 'area', 'veganStatus', 'whatToOrder', 'mapsUrl'].includes(field) ? field : 'form';
      setErrors({ [key]: errorMessage(err) });
    }
  };

  const otherArea = area && !POPULAR_AREAS.some((a) => a.value === area) ? area : null;

  return (
    <>
      <TopBar title="Add a place" back />
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          <Field
            label="Name"
            value={name}
            maxLength={NAME_MAX}
            autoComplete="off"
            enterKeyHint="next"
            onChange={(e) => setName(e.target.value)}
            error={errors.name}
          />
          <DuplicateHint name={name} kind="place" />
        </div>

        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="mb-2 text-sm font-bold text-ink">Area</legend>
          <div role="group" aria-label="Area" className="flex flex-wrap gap-2">
            {otherArea && <Chip selected onClick={() => setArea(null)}>{otherArea}</Chip>}
            {POPULAR_AREAS.map((a) => (
              <Chip key={a.value} selected={area === a.value} onClick={() => setArea(area === a.value ? null : a.value)}>{a.label}</Chip>
            ))}
            <Chip selected={false} onClick={() => setAreaSheet(true)} icon={<ChevronDown size={16} aria-hidden="true" />}>All areas</Chip>
          </div>
          {errors.area && <p role="alert" className="text-sm font-semibold text-danger">{errors.area}</p>}
        </fieldset>

        <ChoiceChips<Status>
          label="Vegan status"
          options={['fully_vegan', 'vegan_options']}
          labelFor={(s) => VEGAN_STATUS_LABEL[s]}
          value={status}
          onChange={setStatus}
          error={errors.veganStatus}
        />

        <ChoiceChips label="Type (optional)" options={PLACE_CATEGORIES} value={category} onChange={setCategory} wrap={false} />

        <div className="flex flex-col gap-2">
          <p className="text-sm font-bold text-ink">Your opinion and a photo (optional)</p>
          <div className="flex flex-wrap items-start gap-2">
            <Chip selected={recommend} onClick={() => setRecommend(!recommend)} icon={<ThumbsUp size={16} aria-hidden="true" />}>
              I recommend it
            </Chip>
            <PhotoPicker value={photo} onChange={setPhoto} onBusy={setUploading} />
          </div>
        </div>

        <Field
          multiline
          label="What to order (optional)"
          value={whatToOrder}
          maxLength={BODY_MAX}
          onChange={(e) => setWhatToOrder(e.target.value)}
          error={errors.whatToOrder}
          hint="No phone numbers or email addresses, please."
          rows={2}
          inputClassName="min-h-16!"
        />

        <Field
          label="Maps link (optional)"
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="A Google Maps or Apple Maps link"
          value={mapsUrl}
          onChange={(e) => setMapsUrl(e.target.value)}
          error={errors.mapsUrl}
        />

        <StickyBar>
          {errors.form && <p role="alert" className="text-sm font-semibold text-danger">{errors.form}</p>}
          <Button type="submit" block busy={create.isPending} busyLabel="Adding" disabled={uploading}>Add place</Button>
        </StickyBar>
      </form>
      <AreaSheet
        open={areaSheet}
        onClose={() => setAreaSheet(false)}
        value={area}
        onPick={(a) => {
          setArea(a);
          setAreaSheet(false);
        }}
      />
    </>
  );
}
