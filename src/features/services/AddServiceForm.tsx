// Add a service. Route: /add/service, already signed in (RequireAccount). The creator owns it at once.
// Default export required: AddRoute lazy loads it.
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Button, Field, StickyBar, TopBar } from '../../ui';
import { ApiError, errorMessage } from '../../api/client';
import { useCreateService } from './api';
import { PhotoPicker } from '../listings/PhotoPicker';
import { VEGAN_STATUS_REQUIRED, type PhotoResponse } from '../../../shared/types/listings';
import { AreaChips, CategoryChips, ContactFields, VeganStatusChips, fieldErrors } from './fields';
import { SERVICE_NAME_MAX, SERVICE_SUMMARY_MAX, type ServiceCategory, type ServiceContactInput, type ServiceVeganStatus } from '../../../shared/types/services';

export default function AddServiceForm() {
  const navigate = useNavigate();
  const create = useCreateService();
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [category, setCategory] = useState<ServiceCategory | null>(null);
  const [area, setArea] = useState<string | null>(null);
  // No default: Fully vegan is a claim, so it is set only when the member picks it.
  const [veganStatus, setVeganStatus] = useState<ServiceVeganStatus | null>(null);
  const [contact, setContact] = useState<ServiceContactInput>({});
  const [photo, setPhoto] = useState<PhotoResponse | null>(null);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (name.trim().length < 2) local.name = 'Enter the name of your service.';
    if (summary.trim().length < 10) local.summary = 'Say a little more about what you offer.';
    if (!category) local.category = 'Pick a category.';
    if (!area) local.area = 'Pick an area, or Delivers across Dubai.';
    if (!veganStatus) local.veganStatus = VEGAN_STATUS_REQUIRED;
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length || !category || !area || !veganStatus) return;
    try {
      const res = await create.mutateAsync({ name: name.trim(), summary: summary.trim(), category, area, veganStatus, photoId: photo?.id ?? null, contact });
      navigate(`/services/${res.slug}`, { replace: true });
    } catch (err) {
      const { form, fields } = fieldErrors(err instanceof ApiError ? err.field : undefined, errorMessage(err));
      setErrors(fields);
      setFormError(form);
    }
  };

  return (
    <>
      <TopBar title="Add your service" back />
      <p className="mb-4 text-base text-muted">Home bakers, caterers, meal prep, classes and shops. Members can recommend you and reach you.</p>
      <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
        <Field label="Name" value={name} maxLength={SERVICE_NAME_MAX} onChange={(e) => setName(e.target.value)} error={errors.name} placeholder="Your business or your name" required />
        <Field
          multiline
          label="What you offer"
          value={summary}
          maxLength={SERVICE_SUMMARY_MAX}
          onChange={(e) => setSummary(e.target.value)}
          error={errors.summary}
          placeholder="Vegan birthday cakes to order, gluten free on request."
          hint="Please keep phone numbers and emails out of this box. Add them below."
          required
        />
        <div>
          <CategoryChips value={category} onChange={setCategory} />
          {errors.category && <p role="alert" className="mt-1 text-sm font-semibold text-danger">{errors.category}</p>}
        </div>
        <VeganStatusChips value={veganStatus} onChange={setVeganStatus} error={errors.veganStatus} />
        <div>
          <AreaChips value={area} onChange={setArea} />
          {errors.area && <p role="alert" className="mt-1 text-sm font-semibold text-danger">{errors.area}</p>}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-bold">Photo (optional)</span>
          <PhotoPicker value={photo} onChange={setPhoto} onBusy={setUploading} />
        </div>

        <ContactFields
          value={contact}
          onChange={setContact}
          errors={{ whatsapp: errors['contact.whatsapp'], instagram: errors['contact.instagram'], website: errors['contact.website'] }}
        />

        <StickyBar>
          {formError && <p role="alert" className="text-sm font-semibold text-danger">{formError}</p>}
          <Button type="submit" block busy={create.isPending} busyLabel="Saving" disabled={uploading}>Add my service</Button>
        </StickyBar>
      </form>
    </>
  );
}
