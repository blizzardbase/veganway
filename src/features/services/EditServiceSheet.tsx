// Owner edit: what you offer, category, area and contact links. Never member recommendations, replies or opinions.
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Tag as TagIcon } from 'lucide-react';
import { Button, Field, Sheet, useToast } from '../../ui';
import { ApiError, errorMessage } from '../../api/client';
import { useUpdateService } from './api';
import { AreaChips, CategoryChips, ContactFields, VeganStatusChips, fieldErrors } from './fields';
import {
  SERVICE_CATEGORIES, SERVICE_SUMMARY_MAX, type ServiceCategory, type ServiceContactInput, type ServiceProfile, type ServiceVeganStatus,
} from '../../../shared/types/services';

function EditForm({ service, onDone }: { service: ServiceProfile; onDone: () => void }) {
  const isService = service.kind === 'service';
  const update = useUpdateService(service.slug);
  const toast = useToast();
  const [summary, setSummary] = useState(service.summary);
  const [category, setCategory] = useState<ServiceCategory | null>(
    (SERVICE_CATEGORIES as readonly string[]).includes(service.category) ? (service.category as ServiceCategory) : null,
  );
  const [area, setArea] = useState<string | null>(service.area);
  const [veganStatus, setVeganStatus] = useState<ServiceVeganStatus | null>(service.veganStatus === 'vegan_product' ? null : service.veganStatus);
  const [contact, setContact] = useState<ServiceContactInput>({
    whatsapp: service.contact?.whatsapp ? `+${service.contact.whatsapp}` : '',
    instagram: service.contact?.instagram ? `@${service.contact.instagram}` : '',
    website: service.contact?.website ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    try {
      await update.mutateAsync({
        id: service.id,
        body: isService
          ? { summary: summary.trim(), ...(category ? { category } : {}), ...(area ? { area } : {}), ...(veganStatus ? { veganStatus } : {}), contact }
          : { summary: summary.trim() },
      });
      toast.show({ message: 'Saved.' });
      onDone();
    } catch (err) {
      const { form, fields } = fieldErrors(err instanceof ApiError ? err.field : undefined, errorMessage(err));
      setErrors(fields);
      setFormError(form);
    }
  };

  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
      <Field multiline label="What you offer" value={summary} maxLength={SERVICE_SUMMARY_MAX} onChange={(e) => setSummary(e.target.value)} error={errors.summary} />
      {isService && <CategoryChips value={category} onChange={setCategory} />}
      {isService && <VeganStatusChips value={veganStatus} onChange={setVeganStatus} />}
      {isService && <AreaChips value={area} onChange={setArea} />}
      {isService && (
        <ContactFields
          value={contact}
          onChange={setContact}
          errors={{ whatsapp: errors['contact.whatsapp'], instagram: errors['contact.instagram'], website: errors['contact.website'] }}
        />
      )}
      <Link to={`/add/offer?listing=${encodeURIComponent(service.slug)}`} className="flex h-11 items-center gap-2 text-sm font-bold text-brand">
        <TagIcon size={18} aria-hidden="true" /> Post an offer
      </Link>
      {formError && <p role="alert" className="text-sm font-semibold text-danger">{formError}</p>}
      <Button type="submit" block busy={update.isPending} busyLabel="Saving">Save changes</Button>
    </form>
  );
}

export function EditServiceSheet({ open, onClose, service }: { open: boolean; onClose: () => void; service: ServiceProfile }) {
  return (
    <Sheet open={open} onClose={onClose} title="Edit your page">
      {/* Remount on open so the form starts from the saved values. */}
      {open && <EditForm service={service} onDone={onClose} />}
    </Sheet>
  );
}
