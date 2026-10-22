// Change password and delete the account (two steps, never a browser confirm).
import { useState, type FormEvent } from 'react';
import { Button, Field, Sheet, useToast } from '../../ui';
import { errorMessage } from '../../api/client';
import { useChangePassword } from '../../api/session';
import { useDeleteAccount } from './api';
import { PASSWORD_MAX, PASSWORD_MIN } from '../../../shared/types';

function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const change = useChangePassword();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next.length < PASSWORD_MIN) {
      setError(`Use at least ${PASSWORD_MIN} characters.`);
      return;
    }
    try {
      await change.mutateAsync({ currentPassword: current, newPassword: next });
      toast.show({ success: true, message: 'Password changed. Other devices were signed out.' });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <Field label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      <Field label="New password" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} value={next} onChange={(e) => setNext(e.target.value)} hint={`At least ${PASSWORD_MIN} characters.`} required />
      {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
      <Button type="submit" block busy={change.isPending} busyLabel="Saving">Change password</Button>
    </form>
  );
}

export function PasswordSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Change password">
      {open && <ChangePasswordForm onDone={onClose} />}
    </Sheet>
  );
}

function DeleteFlow({ onDeleted }: { onDeleted: () => void }) {
  const del = useDeleteAccount();
  const [step, setStep] = useState<1 | 2>(1);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (step === 1) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-base">Deleting your account:</p>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-base">
          <li>signs you out everywhere and removes your email fingerprint and password;</li>
          <li>clears your display name, bio, photo and saved places;</li>
          <li>keeps what you posted, shown as Former member;</li>
          <li>frees any service you run so its real owner can claim it.</li>
        </ul>
        <p className="text-base font-bold">This cannot be undone.</p>
        <Button variant="danger" block onClick={() => setStep(2)}>Continue</Button>
      </div>
    );
  }
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await del.mutateAsync({ password });
      onDeleted();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <Field label="Enter your password to confirm" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={error} required />
      <Button type="submit" variant="danger" block busy={del.isPending} busyLabel="Deleting">Delete my account</Button>
    </form>
  );
}

export function DeleteAccountSheet({ open, onClose, onDeleted }: { open: boolean; onClose: () => void; onDeleted: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Delete your account">
      {open && <DeleteFlow onDeleted={onDeleted} />}
    </Sheet>
  );
}
