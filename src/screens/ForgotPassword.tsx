import { useState, type FormEvent } from 'react';
import { Button, Field, TopBar } from '../ui';
import { useMe, useForgotPassword } from '../api/session';
import { errorMessage } from '../api/client';

export function ForgotPassword() {
  const { isPending: sessionPending } = useMe();
  const forgot = useForgotPassword();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (forgot.isPending || sessionPending) return;
    setError(null);
    try {
      await forgot.mutateAsync({ email });
      setEmail('');
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <div className="flex flex-1 flex-col">
      <TopBar back="/signin" />
      <h1 className="text-2xl font-extrabold">Forgot password?</h1>
      <p className="mt-2 text-base text-muted">Enter the email you joined with. We will send you a link to choose a new password.</p>
      {forgot.isSuccess ? (
        <p role="status" className="mt-6 text-base">{forgot.data.message}</p>
      ) : (
        <form className="mt-6 flex flex-1 flex-col gap-5" onSubmit={onSubmit}>
          <Field label="Email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} value={email} onChange={(event) => setEmail(event.target.value)} required />
          {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
          <div className="mt-auto pt-6">
            <Button type="submit" block disabled={sessionPending} busy={forgot.isPending} busyLabel="Sending">Send reset link</Button>
          </div>
        </form>
      )}
    </div>
  );
}
