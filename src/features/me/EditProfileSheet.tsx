// Edit the optional public profile: display name, bio and photo. The pseudonym stays.
import { useRef, useState, type FormEvent } from 'react';
import { ImagePlus } from 'lucide-react';
import { Avatar, Button, Field, Sheet, useToast } from '../../ui';
import { ApiError, errorMessage } from '../../api/client';
import { uploadPhoto } from '../listings/photo';
import { useUpdateProfile } from './api';
import { DISPLAY_NAME_MAX, type Profile } from '../../../shared/types/me';
import { BIO_MAX } from '../../../shared/types/services';

function EditForm({ profile, onDone }: { profile: Profile; onDone: () => void }) {
  const update = useUpdateProfile();
  const toast = useToast();
  const [displayName, setDisplayName] = useState(profile.displayName ?? '');
  const [bio, setBio] = useState(profile.bio ?? '');
  const [avatar, setAvatar] = useState<{ id: string | null; url: string | null }>({ id: profile.avatarPhotoId, url: profile.avatarUrl });
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setFormError(null);
    try {
      const p = await uploadPhoto(file);
      setAvatar({ id: p.id, url: p.url });
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    try {
      await update.mutateAsync({ displayName: displayName.trim() || null, bio: bio.trim() || null, avatarPhotoId: avatar.id });
      toast.show({ message: 'Profile saved.' });
      onDone();
    } catch (err) {
      const field = err instanceof ApiError ? err.field : undefined;
      if (field) setErrors({ [field]: errorMessage(err) });
      else setFormError(errorMessage(err));
    }
  };

  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
      <div className="flex items-center gap-4">
        <Avatar name={displayName || profile.pseudonym} src={avatar.url} size="lg" />
        <div className="flex flex-col gap-1">
          <label className="inline-flex h-11 cursor-pointer items-center gap-2 text-sm font-bold text-brand">
            <ImagePlus size={18} aria-hidden="true" />
            {uploading ? 'Adding photo' : avatar.url ? 'Change photo' : 'Add a photo'}
            <input ref={fileRef} type="file" accept="image/*" className="sr-only" disabled={uploading} onChange={(e) => void onPhoto(e.target.files?.[0])} />
          </label>
          {avatar.url && (
            <button type="button" className="h-11 self-start text-sm font-bold text-danger" onClick={() => setAvatar({ id: null, url: null })}>Remove photo</button>
          )}
        </div>
      </div>
      <p className="text-sm text-muted">Everything here is optional and public. Your name {profile.pseudonym} always shows.</p>
      <Field
        label="Display name"
        value={displayName}
        maxLength={DISPLAY_NAME_MAX}
        onChange={(e) => setDisplayName(e.target.value)}
        error={errors.displayName}
        autoComplete="off"
      />
      <Field multiline label="Bio" value={bio} maxLength={BIO_MAX} onChange={(e) => setBio(e.target.value)} error={errors.bio} hint={`${bio.length} of ${BIO_MAX}`} />
      {formError && <p role="alert" className="text-sm font-semibold text-danger">{formError}</p>}
      <Button type="submit" block busy={update.isPending} busyLabel="Saving" disabled={uploading}>Save</Button>
    </form>
  );
}

export function EditProfileSheet({ open, onClose, profile }: { open: boolean; onClose: () => void; profile: Profile | undefined }) {
  return (
    <Sheet open={open} onClose={onClose} title="Edit profile">
      {open && profile && <EditForm profile={profile} onDone={onClose} />}
    </Sheet>
  );
}
