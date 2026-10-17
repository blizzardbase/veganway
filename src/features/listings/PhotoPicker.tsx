// One optional photo. It uploads as soon as it is chosen, so the form's submit stays instant.
import { useId, useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';
import { IconButton } from '../../ui';
import { errorMessage } from '../../api/client';
import { uploadPhoto } from './photo';
import type { PhotoResponse } from '../../../shared/types/listings';

export function PhotoPicker({ value, onChange, onBusy, label = 'Add a photo' }: {
  value: PhotoResponse | null;
  onChange: (photo: PhotoResponse | null) => void;
  onBusy?: (busy: boolean) => void;
  label?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    onBusy?.(true);
    try {
      onChange(await uploadPhoto(file));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      onBusy?.(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {value ? (
        <div className="relative w-fit">
          <img src={value.url} alt="Your photo" className="h-28 w-auto max-w-full rounded-card object-cover" />
          <IconButton label="Remove photo" tone="soft" onClick={() => onChange(null)} className="absolute top-1 right-1">
            <X size={18} aria-hidden="true" />
          </IconButton>
        </div>
      ) : (
        <label
          htmlFor={id}
          aria-busy={busy || undefined}
          className="flex h-12 w-fit cursor-pointer items-center gap-2 rounded-input border border-dashed border-line bg-surface px-4 text-base font-semibold text-ink transition hover:bg-surface-2 focus-within:outline-2 focus-within:outline-brand"
        >
          <Camera size={20} aria-hidden="true" className="text-brand" />
          {busy ? 'Uploading photo' : label}
          <input
            ref={input}
            id={id}
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={busy}
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </label>
      )}
      {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
    </div>
  );
}
