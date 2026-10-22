// Form pieces shared by the Add service form and the owner Edit sheet.
import { Chip, ChipRow, Field } from '../../ui';
import { SERVICE_AREAS, SERVICE_CATEGORIES, SERVICE_VEGAN_STATUSES, type ServiceCategory, type ServiceContactInput, type ServiceVeganStatus } from '../../../shared/types/services';
import { areaLabel, VEGAN_STATUS_LABEL } from '../../../shared/types/listings';

export function CategoryChips({ value, onChange }: { value: ServiceCategory | null; onChange: (c: ServiceCategory) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-bold">Category</span>
      <ChipRow label="Category">
        {SERVICE_CATEGORIES.map((c) => (
          <Chip key={c} selected={value === c} onClick={() => onChange(c)}>{c}</Chip>
        ))}
      </ChipRow>
    </div>
  );
}

/** Fully vegan or Vegan options. Nothing is chosen until the member picks. */
export function VeganStatusChips({ value, onChange, error }: { value: ServiceVeganStatus | null; onChange: (v: ServiceVeganStatus) => void; error?: string | null }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-bold">Is everything you make vegan?</span>
      <div role="group" aria-label="Vegan status" className="flex flex-wrap gap-2">
        {SERVICE_VEGAN_STATUSES.map((v) => (
          <Chip key={v} selected={value === v} onClick={() => onChange(v)}>{VEGAN_STATUS_LABEL[v]}</Chip>
        ))}
      </div>
      {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
    </div>
  );
}

export function AreaChips({ value, onChange }: { value: string | null; onChange: (a: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-bold">Area</span>
      <ChipRow label="Area">
        {SERVICE_AREAS.map((a) => (
          <Chip key={a} selected={value === a} onClick={() => onChange(a)}>{areaLabel(a)}</Chip>
        ))}
      </ChipRow>
    </div>
  );
}

export function ContactFields({ value, onChange, errors }: {
  value: ServiceContactInput;
  onChange: (v: ServiceContactInput) => void;
  errors: Partial<Record<keyof ServiceContactInput, string | null>>;
}) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-1 text-sm font-bold">How can members reach you? (optional)</legend>
      <p className="-mt-2 text-sm text-muted">Only what you fill in shows, and only on your service page.</p>
      <Field
        label="WhatsApp number or wa.me link"
        inputMode="tel"
        autoComplete="off"
        placeholder="+971 50 123 4567"
        value={value.whatsapp ?? ''}
        onChange={(e) => onChange({ ...value, whatsapp: e.target.value })}
        error={errors.whatsapp}
      />
      <Field
        label="Instagram handle"
        autoComplete="off"
        autoCapitalize="none"
        placeholder="@yourbakery"
        value={value.instagram ?? ''}
        onChange={(e) => onChange({ ...value, instagram: e.target.value })}
        error={errors.instagram}
      />
      <Field
        label="Website"
        type="url"
        inputMode="url"
        autoComplete="off"
        autoCapitalize="none"
        placeholder="https://"
        value={value.website ?? ''}
        onChange={(e) => onChange({ ...value, website: e.target.value })}
        error={errors.website}
      />
    </fieldset>
  );
}

/** Map an API error field like "contact.whatsapp" to the right input. */
export function fieldErrors(field: string | undefined, message: string): { form: string | null; fields: Record<string, string> } {
  if (!field) return { form: message, fields: {} };
  return { form: null, fields: { [field]: message } };
}
