import { useLayoutEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button, Field, TopBar } from '../ui';
import { ApiError, errorMessage } from '../api/client';
import { useMe, useResetPassword } from '../api/session';
import { PASSWORD_MAX, PASSWORD_MIN } from '../../shared/types';

export function Reset() {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '');
  const navigate = useNavigate();
  const { isPending: sessionPending } = useMe();
  const reset = useResetPassword();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(!/^[A-Za-z0-9_-]{43}$/.test(token));
  useLayoutEffect(() => {
    // Keep the token only in this screen's memory, never in history, storage or referrers.
    window.history.replaceState(window.history.state, '', '/reset');
  }, []);
  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (reset.isPending || sessionPending) return;
    setError(null);
    if (password !== repeat) {
      setError('The passwords do not match.');
      return;
    }
    try {
      await reset.mutateAsync({ token, newPassword: password });
      navigate('/signin?reset=done', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'bad_reset') setInvalid(true);
      else setError(errorMessage(err));
    }
  };
  return (
    <div className="flex flex-1 flex-col">
      <TopBar back="/signin" />
      <h1 className="text-2xl font-extrabold">Reset your password</h1>
      {invalid ? (
        <div className="mt-6 flex flex-col gap-4">
          <p role="alert" className="text-base text-danger">That reset link is invalid or has expired. Request a new link.</p>
          <Link to="/forgot-password" className="inline-flex min-h-11 items-center font-bold text-ink">Request a new link</Link>
        </div>
      ) : (
        <>
          <p className="mt-2 text-base text-muted">Choose a new password. Every device will be signed out.</p>
          <form className="mt-6 flex flex-1 flex-col gap-5" onSubmit={onSubmit}>
            <Field label="New password" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} value={password} onChange={(event) => setPassword(event.target.value)} hint={`At least ${PASSWORD_MIN} characters.`} required />
            <Field label="Repeat new password" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} value={repeat} onChange={(event) => setRepeat(event.target.value)} required />
            {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
            <div className="mt-auto pt-6">
              <Button type="submit" block disabled={sessionPending} busy={reset.isPending} busyLabel="Resetting">Reset password</Button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
