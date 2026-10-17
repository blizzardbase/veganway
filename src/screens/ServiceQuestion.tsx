import { ChefHat } from 'lucide-react';
import { ButtonLink } from '../ui';

export function ServiceQuestion() {
  return (
    // One block, centred on the screen: the question, then its two answers right under it.
    <div className="flex flex-1 flex-col justify-center py-8">
      <div className="flex size-16 items-center justify-center rounded-full bg-brand-soft text-brand">
        <ChefHat size={30} aria-hidden="true" />
      </div>
      <h1 className="mt-6 text-2xl font-extrabold">Do you bake, cook or run a vegan service?</h1>
      <p className="mt-2 text-base text-muted">
        Add it now and members can find you. You choose which contact details to show. You can also do this later from Me.
      </p>
      <div className="mt-8 flex flex-col gap-3">
        <ButtonLink to="/add/service" replace block>Yes, add my service</ButtonLink>
        <ButtonLink to="/" replace variant="secondary" block>Later</ButtonLink>
      </div>
    </div>
  );
}
