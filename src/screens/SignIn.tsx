import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { Button, Field, TopBar } from '../ui';
import { errorMessage } from '../api/client';
import { useMe, useSignIn } from '../api/session';
import { safeNext } from '../features/auth/Gate';

export function SignIn() {
  const [params] = useSearchParams();
  const rawNext = params.get('next');
  const next = safeNext(rawNext, '/');
  const navigate = useNavigate();
  const { data } = useMe();
  const signIn = useSignIn();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (data?.user && !signIn.isSuccess) return <Navigate to={next} replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    try {
      await signIn.mutateAsync({ email, password });
      navigate(next, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const keepNext = rawNext ? `?next=${encodeURIComponent(rawNext)}` : '';

  return (
    <div className="flex flex-1 flex-col">
      <TopBar back="/welcome" />
      <h1 className="text-2xl font-extrabold">Welcome back</h1>
      <p className="mt-2 text-base text-muted">Sign in with the email and password you joined with.</p>
      {params.get('reset') === 'done' && <p role="status" className="mt-4 text-base font-semibold text-brand">Password changed. Sign in with your new password.</p>}
      <form className="mt-6 flex flex-1 flex-col gap-5" onSubmit={onSubmit} noValidate>
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
        <Link to="/forgot-password" className="inline-flex min-h-11 items-center self-start text-sm font-bold text-ink">
          Forgot password?
        </Link>
        <div className="mt-auto flex flex-col gap-4 pt-6">
          <Button type="submit" block busy={signIn.isPending} busyLabel="Signing in">Sign in</Button>
          <p className="text-center text-sm text-muted">
            New here?{' '}
            <Link to={`/join${keepNext}`} className="inline-flex min-h-11 min-w-11 items-center justify-center px-2 font-bold text-ink">Join</Link>
          </p>
        </div>
      </form>
    </div>
  );
}
