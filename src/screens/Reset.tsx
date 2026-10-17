import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Button, Field, TopBar } from '../ui';
import { ApiError, errorMessage } from '../api/client';
import { useResetWithCode } from '../api/session';
import { holdRecovery } from '../features/auth/recoveryStore';
import { safeNext } from '../features/auth/Gate';
import { PASSWORD_MIN } from '../../shared/types';

export function Reset() {
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'), '/');
  const navigate = useNavigate();
  const reset = useResetWithCode();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; recoveryCode?: string; newPassword?: string; form?: string }>({});

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const local: typeof errors = {};
    if (!email.trim()) local.email = 'Enter your email address.';
    if (code.replace(/[^0-9A-Za-z]/g, '').length !== 20) local.recoveryCode = 'Your recovery code has 20 characters.';
    if (password.length < PASSWORD_MIN) local.newPassword = `Use at least ${PASSWORD_MIN} characters.`;
    setErrors(local);
    if (Object.keys(local).length) return;
    try {
      const res = await reset.mutateAsync({ email, recoveryCode: code, newPassword: password });
      holdRecovery({ code: res.recoveryCode, email: email.trim(), next, reason: 'reset' });
      navigate('/join/recovery', { replace: true, state: { next } });
    } catch (err) {
      if (err instanceof ApiError && err.field && ['email', 'recoveryCode', 'newPassword'].includes(err.field)) setErrors({ [err.field]: err.message });
      else setErrors({ form: errorMessage(err) });
    }
  };

  return (
    <div className="flex flex-1 flex-col">
      <TopBar back="/signin" />
      <h1 className="text-2xl font-extrabold">Reset your password</h1>
      <p className="mt-2 text-base text-muted">
        Enter your email, your recovery code and a new password. You then get a new recovery code, and every other device is signed out.
      </p>
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
          error={errors.email}
          required
        />
        <Field
          label="Recovery code"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="XXXX XXXX XXXX XXXX XXXX"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          error={errors.recoveryCode}
          inputClassName="font-mono tracking-wider"
          required
        />
        <Field
          label="New password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.newPassword}
          hint={`At least ${PASSWORD_MIN} characters.`}
          required
        />
        {errors.form && <p role="alert" className="text-sm font-semibold text-danger">{errors.form}</p>}
        <div className="mt-auto pt-6">
          <Button type="submit" block busy={reset.isPending} busyLabel="Resetting">Reset password</Button>
        </div>
      </form>
    </div>
  );
}
