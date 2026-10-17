// First run: the whole app has no content yet. Explains what VeganWay is and offers three ways to start.
import { ChefHat, MessagesSquare, Sprout, Store } from 'lucide-react';
import { ButtonLink } from '../../ui';

export function WelcomeCard() {
  return (
    <section aria-labelledby="welcome-h" data-testid="welcome-card" className="flex flex-col gap-4 rounded-card border border-line bg-brand-soft p-5">
      <span className="flex size-12 items-center justify-center rounded-full bg-brand text-on-brand">
        <Sprout size={24} aria-hidden="true" />
      </span>
      <div className="flex flex-col gap-2">
        <h2 id="welcome-h" className="text-xl font-extrabold">Welcome to VeganWay</h2>
        <p className="text-base">
          A home for the group's vegan finds in Dubai: the places, products and home cooks members love.
        </p>
        <p className="text-sm text-muted">
          Built by members, for members. No ads and no tracking. It starts empty, so the first finds are yours.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <ButtonLink to="/add/place" block>
          <Store size={18} aria-hidden="true" />
          Add a place
        </ButtonLink>
        <ButtonLink to="/add/discussion" variant="secondary" block>
          <MessagesSquare size={18} aria-hidden="true" />
          Start a discussion
        </ButtonLink>
        <ButtonLink to="/add/service" variant="secondary" block>
          <ChefHat size={18} aria-hidden="true" />
          Showcase your service
        </ButtonLink>
      </div>
    </section>
  );
}
