// The first screen anyone from the WhatsApp link sees: an illustration, what the app is for in three
// rows, the privacy promise, then Join, Sign in and a quiet way to look around first.
import { useNavigate } from 'react-router';
import { m, useReducedMotion, type Variants } from 'motion/react';
import { Compass, MessagesSquare, ShieldCheck, Tag, type LucideIcon } from 'lucide-react';
import { ButtonLink, Wordmark } from '../ui';
import { markBrowsing } from '../features/auth/browse';
import { WelcomeArt } from '../features/auth/WelcomeArt';

const VALUES: { icon: LucideIcon; text: string }[] = [
  { icon: Compass, text: 'Find vegan places and products the group loves' },
  { icon: Tag, text: 'Share what to order and the best deals' },
  { icon: MessagesSquare, text: 'Talk, vote and help each other' },
];

// Text slides up without fading, so it keeps full contrast at every frame; only the picture fades.
const list: Variants = { hidden: {}, shown: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } } };
const item: Variants = {
  hidden: { y: 14 },
  shown: { y: 0, transition: { duration: 0.34, ease: [0.2, 0.8, 0.2, 1] } },
};
const art: Variants = {
  hidden: { opacity: 0, scale: 0.94 },
  shown: { opacity: 1, scale: 1, transition: { duration: 0.45, ease: [0.2, 0.8, 0.2, 1] } },
};

export function Welcome() {
  const navigate = useNavigate();
  const still = useReducedMotion();
  return (
    <m.div
      className="welcome-screen flex flex-1 flex-col pt-[max(24px,env(safe-area-inset-top))] short:pt-[max(16px,env(safe-area-inset-top))]"
      variants={list}
      initial={still ? false : 'hidden'}
      animate="shown"
    >
      <m.div variants={item}><Wordmark size="lg" /></m.div>

      <m.div variants={art} className="-mx-2 mt-2">
        <WelcomeArt className="mx-auto h-auto w-full max-w-[340px] short:max-w-[232px]" />
      </m.div>

      <m.div variants={item} className="mt-2 flex flex-col gap-2 short:gap-1">
        <h1 className="text-2xl font-extrabold short:text-[24px] short:leading-[30px]"><span className="welcome-first-line">The Dubai vegan community,</span>{' '}in one place.</h1>
        <p className="text-base text-muted">Places, products, home bakers and good talk, shared by members.</p>
      </m.div>

      <m.ul variants={item} className="stagger-list welcome-features mt-5 flex flex-col gap-3 short:mt-4 short:gap-2">
        {VALUES.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink short:size-8">
              <Icon size={18} aria-hidden="true" />
            </span>
            <span className="text-base font-semibold short:text-sm">{text}</span>
          </li>
        ))}
      </m.ul>

      <m.p variants={item} className="mt-5 flex items-start gap-2 text-sm text-muted short:mt-4">
        <ShieldCheck size={18} className="mt-px shrink-0 text-ink" aria-hidden="true" />
        <span>No phone number. We never store your email. We only email password reset links and never track you.</span>
      </m.p>

      <m.div variants={item} className="mt-auto flex flex-col gap-3 pt-6 short:gap-2 short:pt-4">
        <ButtonLink to="/join" block>Join</ButtonLink>
        <ButtonLink to="/signin" variant="secondary" block>Sign in</ButtonLink>
        <button
          type="button"
          className="mx-auto inline-flex h-11 items-center px-4 text-sm font-bold text-muted underline-offset-4 hover:text-ink hover:underline"
          onClick={() => {
            markBrowsing();
            navigate('/');
          }}
        >
          Look around first
        </button>
      </m.div>
    </m.div>
  );
}
