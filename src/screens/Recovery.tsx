import { useId, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { Copy, Download, KeyRound } from 'lucide-react';
import { Button, Field, useToast } from '../ui';
import { errorMessage } from '../api/client';
import { useMe, useNewRecoveryCode } from '../api/session';
import { clearRecovery, peekRecovery, type PendingRecovery } from '../features/auth/recoveryStore';
import { safeNext } from '../features/auth/Gate';

function lastFour(code: string): string {
  return code.replace(/[^0-9A-Za-z]/g, '').slice(-4).toUpperCase();
}

function downloadCode(code: string, email: string) {
  const text = [
    'VeganWay DXB recovery code',
    '',
    `Account email: ${email}`,
    `Recovery code: ${code}`,
    '',
    'Keep this file somewhere safe. With your email and this code you can set a new password.',
    'We never send email, so this code is the only way back in.',
    '',
  ].join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'veganway-recovery-code.txt';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Shown when the code is gone from memory (a reload): issue a fresh one with the password. */
function LostCode({ onIssued }: { onIssued: (code: string) => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const issue = useNewRecoveryCode();
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await issue.mutateAsync({ password });
      onIssued(res.recoveryCode);
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <div className="flex flex-1 flex-col pt-8">
      <KeyRound size={32} className="text-brand" aria-hidden="true" />
      <h1 className="mt-3 text-2xl font-extrabold">Make a new recovery code</h1>
      <p className="mt-2 text-base text-muted">
        We show a recovery code only once, and this page was reloaded. Enter your password to make a new one. The old one stops working.
      </p>
      <form className="mt-6 flex flex-col gap-5" onSubmit={onSubmit}>
        <Field label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={error} required />
        <Button type="submit" block busy={issue.isPending} busyLabel="Making your code">Make a new code</Button>
      </form>
    </div>
  );
}

/** An email that wraps after the @ or a dot when it must, never in the middle of a word. */
function BreakableEmail({ email }: { email: string }) {
  const parts = email.split(/(?<=[@.])/);
  return <>{parts.map((p, i) => <span key={i}>{i > 0 && <wbr />}{p}</span>)}</>;
}

export function Recovery() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { data, isPending } = useMe();
  const checkboxId = useId();
  const [pending, setPending] = useState<PendingRecovery | null>(peekRecovery);
  const [saved, setSaved] = useState(false);
  const [typed, setTyped] = useState('');

  if (isPending) return null;
  if (!data?.user) return <Navigate to="/signin" replace />;

  const fallbackNext = safeNext((location.state as { next?: string } | null)?.next, '/join/service');
  if (!pending) {
    return <LostCode onIssued={(code) => setPending({ code, email: '', next: fallbackNext, reason: 'reset' })} />;
  }

  const ready = saved && lastFour(typed) === lastFour(pending.code) && typed.replace(/[^0-9A-Za-z]/g, '').length === 4;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(pending.code);
      toast.show({ message: 'Recovery code copied.' });
    } catch {
      toast.show({ message: 'Copy did not work. Write the code down or download it.' });
    }
  };

  const onContinue = () => {
    clearRecovery();
    navigate(safeNext(pending.next, '/'), { replace: true });
  };

  return (
    <div className="flex flex-1 flex-col pt-6">
      {pending.reason === 'signup' && <p className="text-sm font-bold text-brand">Step 3 of 3</p>}
      <h1 className="mt-1 text-2xl font-extrabold">{pending.reason === 'reset' ? 'Your new recovery code' : 'Save your recovery code'}</h1>
      <p className="mt-2 text-base text-muted">
        We never send email, so this code is the only way back in if you forget your password. We show it once.
        {pending.reason === 'reset' && ' Your old code no longer works.'}
      </p>

      <div className="mt-6 rounded-card border border-line bg-surface p-4 shadow-1">
        {pending.email && (
          <p className="text-sm text-muted">
            For <span className="font-bold break-words text-ink" data-testid="recovery-email"><BreakableEmail email={pending.email} /></span>
          </p>
        )}
        <p
          data-testid="recovery-code"
          className="mt-3 text-center font-mono text-lg font-bold tracking-wide text-ink select-all"
        >
          {pending.code.split('-').map((group, i, all) => (
            <span key={i} className="inline-block whitespace-nowrap">{group}{i < all.length - 1 ? '-' : ''}</span>
          ))}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Button variant="secondary" size="md" icon={<Copy size={18} aria-hidden="true" />} onClick={onCopy}>Copy</Button>
          <Button variant="secondary" size="md" icon={<Download size={18} aria-hidden="true" />} onClick={() => downloadCode(pending.code, pending.email)}>
            Download
          </Button>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-4">
        <label htmlFor={checkboxId} className="flex min-h-11 cursor-pointer items-center gap-3 text-base font-semibold">
          <input
            id={checkboxId}
            type="checkbox"
            checked={saved}
            onChange={(e) => setSaved(e.target.checked)}
            className="size-6 shrink-0 accent-[var(--color-brand)]"
          />
          I saved my recovery code
        </label>
        <Field
          label="Type the last 4 characters"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={6}
          inputClassName="font-mono tracking-wider"
          hint="This checks that you have it."
        />
      </div>

      <div className="mt-auto pt-8">
        <Button block disabled={!ready} onClick={onContinue}>Continue</Button>
      </div>
    </div>
  );
}
