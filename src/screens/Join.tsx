import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { Shuffle, VenetianMask } from 'lucide-react';
import { Button, Field, TopBar } from '../ui';
import { ApiError, errorMessage } from '../api/client';
import { useConfirmPseudonym, useMe, useShuffle, useSignUp } from '../api/session';
import { holdRecovery, peekRecovery } from '../features/auth/recoveryStore';
import { safeNext } from '../features/auth/Gate';
import { PASSWORD_MIN } from '../../shared/types';

// Decoys for the reveal: the same playful shape as real names, shown for a blink each.
const DECOY_FIRST = ['Sunny', 'Zesty', 'Mellow', 'Toasty', 'Breezy', 'Golden', 'Minty', 'Plucky'];
const DECOY_FOOD = ['Lentil', 'Tahini', 'Fig', 'Okra', 'Sumac', 'Dosa', 'Quinoa', 'Cashew'];
const TICKS = [70, 70, 80, 90, 110, 140, 180];

/** A short shuffle of names that lands on the real one. Nothing moves under reduced motion. */
function useNameShuffle(name: string): string | null {
  const still = useReducedMotion();
  const [decoy, setDecoy] = useState<{ for: string; text: string | null }>({ for: name, text: DECOY_FIRST[0] });
  useEffect(() => {
    if (still) return;
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      const text = i < TICKS.length
        ? `${DECOY_FIRST[(i * 3 + name.length) % DECOY_FIRST.length]} ${DECOY_FOOD[(i * 5 + name.length) % DECOY_FOOD.length]}`
        : null;
      setDecoy({ for: name, text });
      if (text) timer = setTimeout(step, TICKS[i]);
      i += 1;
    };
    timer = setTimeout(step, 0);
    return () => clearTimeout(timer);
  }, [name, still]);
  if (still) return null;
  // A new name (after Shuffle) starts a fresh run, so show a decoy until the run reaches it.
  return decoy.for === name ? decoy.text : DECOY_FIRST[1];
}

function NameReveal({ name }: { name: string }) {
  const decoy = useNameShuffle(name);
  return (
    <div className="flex min-h-[68px] items-center justify-center" aria-live="polite">
      {decoy ? (
        <p aria-hidden="true" className="text-center text-2xl font-extrabold text-muted">{decoy}</p>
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          <m.p
            key={name}
            data-testid="pseudonym"
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 420, damping: 22 }}
            className="text-center text-2xl font-extrabold text-brand"
          >
            {name}
          </m.p>
        </AnimatePresence>
      )}
    </div>
  );
}

export function Join() {
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'), '/join/service');
  const navigate = useNavigate();
  const { data } = useMe();
  const signUp = useSignUp();
  const shuffle = useShuffle();
  const confirm = useConfirmPseudonym();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});

  const user = data?.user ?? null;
  if (user?.pseudonymConfirmed && !confirm.isSuccess) return <Navigate to={safeNext(params.get('next'), '/')} replace />;
  const revealing = Boolean(user && !user.pseudonymConfirmed);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const local: typeof errors = {};
    if (!email.trim()) local.email = 'Enter your email address.';
    if (password.length < PASSWORD_MIN) local.password = `Use at least ${PASSWORD_MIN} characters.`;
    setErrors(local);
    if (local.email || local.password) return;
    try {
      const res = await signUp.mutateAsync({ email, password });
      holdRecovery({ code: res.recoveryCode, email: email.trim(), next, reason: 'signup' });
      setPassword('');
    } catch (err) {
      if (err instanceof ApiError && (err.field === 'email' || err.field === 'password')) setErrors({ [err.field]: err.message });
      else setErrors({ form: errorMessage(err) });
    }
  };

  const onKeep = async () => {
    try {
      await confirm.mutateAsync();
      const pending = peekRecovery();
      navigate('/join/recovery', { replace: true, state: { next: pending?.next ?? next } });
    } catch (err) {
      setErrors({ form: errorMessage(err) });
    }
  };

  if (revealing && user) {
    return (
      <div className="flex flex-1 flex-col pt-6">
        <p className="text-sm font-bold text-brand">Step 2 of 3</p>
        <h1 className="mt-1 text-2xl font-extrabold">Meet your community name</h1>
        <p className="mt-2 text-base text-muted">
          Members see this name, never your email. You can add a display name later in Me.
        </p>
        <div className="mt-8 flex flex-col items-center gap-4 rounded-card border border-line bg-gradient-to-b from-brand-soft to-surface p-6 shadow-1">
          <NameReveal name={user.pseudonym} />
          {/* The mask sits centred above the centred line, so the block reads as one shape. */}
          <p className="flex max-w-[30ch] flex-col items-center gap-1 text-center text-sm text-muted">
            <VenetianMask size={20} aria-hidden="true" className="shrink-0 text-brand" />
            <span>This name keeps you anonymous. You can change how you show up later in Me.</span>
          </p>
          <Button
            variant="secondary"
            size="md"
            icon={<Shuffle size={18} aria-hidden="true" />}
            busy={shuffle.isPending}
            onClick={() => shuffle.mutate(undefined, { onError: (err) => setErrors({ form: errorMessage(err) }) })}
          >
            Shuffle
          </Button>
        </div>
        {errors.form && <p role="alert" className="mt-4 text-sm font-semibold text-danger">{errors.form}</p>}
        <div className="mt-auto pt-8">
          <Button block onClick={onKeep} busy={confirm.isPending} busyLabel="Saving">Keep this name</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <TopBar back="/welcome" />
      <p className="text-sm font-bold text-brand">Step 1 of 3</p>
      <h1 className="mt-1 text-2xl font-extrabold">Join VeganWay</h1>
      <p className="mt-2 text-base text-muted">No phone number and no real name. Just an email and a password.</p>
      <form className="mt-6 flex flex-1 flex-col gap-5" onSubmit={onSubmit} noValidate>
        <Field
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          hint="Any email works, even a burner. We never send email."
          required
        />
        <Field
          label="Password"
          type="password"
          name="new-password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          hint={`At least ${PASSWORD_MIN} characters.`}
          required
          minLength={PASSWORD_MIN}
        />
        {errors.form && <p role="alert" className="text-sm font-semibold text-danger">{errors.form}</p>}
        <div className="mt-auto flex flex-col gap-4 pt-6">
          <Button type="submit" block busy={signUp.isPending} busyLabel="Creating your account">Continue</Button>
          <p className="text-center text-sm text-muted">
            Already a member?{' '}
            <Link to={`/signin${params.get('next') ? `?next=${encodeURIComponent(params.get('next') ?? '')}` : ''}`} className="inline-flex min-h-11 items-center font-bold text-brand">
              Sign in
            </Link>
          </p>
        </div>
      </form>
    </div>
  );
}
