// Me: pseudonym and profile, Saved, My posts, My service, Theme, Change password, Privacy,
// Admin (admins only), Sign out and Delete account.
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { ChefHat, ChevronRight, KeyRound, LogOut, Pencil, ShieldCheck, ShieldQuestion, Trash2, UserRound } from 'lucide-react';
import { Avatar, Button, Card, EmptyState, IconButton, InlineEmpty, Segmented, Tag, TopBar, useToast } from '../ui';
import { ListSkeleton } from '../ui/Skeleton';
import { useMe, useSignOut } from '../api/session';
import { useTheme, type ThemeChoice } from '../lib/theme';
import { useMyPosts, useMyService, useProfile, useUpdateProfile } from '../features/me/api';
import { EditProfileSheet } from '../features/me/EditProfileSheet';
import { DeleteAccountSheet, PasswordSheet } from '../features/me/AccountSheets';
import { PostsList, listingPath } from '../features/me/Lists';
import { RequestError } from '../features/me/RequestError';
import { SavedList } from '../features/listings/SavedList';

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = `me-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <section aria-labelledby={id} className="settings-group flex flex-col gap-2">
      <h2 id={id} className="text-sm font-bold text-muted">{title}</h2>
      {children}
    </section>
  );
}

function NavRow({ to, icon, label, onClick }: { to?: string; icon: ReactNode; label: string; onClick?: () => void }) {
  const cls = 'flex h-14 w-full items-center gap-3 rounded-input px-2 text-left text-base font-bold hover:bg-surface-2';
  const inner = (
    <>
      <span className="text-ink">{icon}</span>
      <span className="flex-1">{label}</span>
      <ChevronRight size={18} aria-hidden="true" className="text-muted" />
    </>
  );
  return to ? <Link to={to} className={cls}>{inner}</Link> : <button type="button" className={cls} onClick={onClick}>{inner}</button>;
}

export function Me() {
  const me = useMe();
  const { data, isPending } = me;
  const user = data?.user;
  const signedIn = Boolean(user);
  const signOut = useSignOut();
  const navigate = useNavigate();
  const toast = useToast();
  const [theme, setTheme] = useTheme();
  const profile = useProfile(signedIn);
  const posts = useMyPosts(signedIn);
  const service = useMyService(signedIn);
  const updateProfile = useUpdateProfile();
  const [sheet, setSheet] = useState<'edit' | 'password' | 'delete' | null>(null);

  const chooseTheme = (t: ThemeChoice) => {
    setTheme(t);
    // Also remembered on the account, so a new device can pick it up. Failure is harmless.
    updateProfile.mutate({ theme: t });
  };

  const onSignOut = () => signOut.mutate(undefined, {
    onSuccess: () => {
      toast.show({ success: true, message: 'Signed out.' });
      navigate('/', { replace: true });
    },
  });

  if (isPending) {
    return (
      <>
        <TopBar title="Me" />
        <ListSkeleton count={2} />
      </>
    );
  }
  if (!user) {
    if (me.isError) {
      return (
        <>
          <TopBar title="Me" />
          <RequestError message="Could not load your account." retry={() => void me.refetch()} busy={me.isFetching} />
        </>
      );
    }
    return (
      <>
        <TopBar title="Me" />
        <EmptyState icon={UserRound} line="Join to save places, recommend and talk." action={{ label: 'Join', to: '/join?next=/me' }} />
        <div className="mt-2 flex flex-col">
          <NavRow to="/signin" icon={<KeyRound size={20} aria-hidden="true" />} label="Sign in" />
          <NavRow to="/privacy" icon={<ShieldQuestion size={20} aria-hidden="true" />} label="Privacy" />
        </div>
        {/* Signed out, the choice lives on this device only. */}
        <Section title="Theme">
          <Segmented<ThemeChoice>
            label="Theme"
            value={theme}
            onChange={setTheme}
            options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
          />
        </Section>
      </>
    );
  }

  const shown = profile.data;
  const myService = service.data?.service;
  const pendingClaims = service.data?.pendingClaims ?? [];

  return (
    <>
      <TopBar title="Me" />
      <div data-loading={profile.isPending || posts.isPending || service.isPending} className="me-settings flex flex-col gap-7 pb-6">
        {me.isError && <RequestError message="Could not load your account." retry={() => void me.refetch()} busy={me.isFetching} />}
        <div className="flex items-center gap-4">
          <Avatar name={user.displayName || user.pseudonym} src={shown?.avatarUrl} size="lg" />
          {/* The name always shows in full: it wraps, and Edit is a small icon button beside it. */}
          <div className="min-w-0 flex-1">
            <p data-testid="me-name" className="text-xl font-extrabold break-words">{user.displayName || user.pseudonym}</p>
            {user.displayName && <p className="text-sm break-words text-muted">{user.pseudonym}</p>}
            {shown?.bio && <p className="mt-1 line-clamp-2 text-sm break-words">{shown.bio}</p>}
            {user.role === 'admin' && <Tag className="mt-1">Admin</Tag>}
          </div>
          <IconButton label="Edit profile" tone="soft" onClick={() => setSheet('edit')} disabled={!shown}>
            <Pencil size={18} aria-hidden="true" />
          </IconButton>
        </div>
        {profile.isError && <RequestError message="Could not load your profile." retry={() => void profile.refetch()} busy={profile.isFetching} />}

        <Section title="Saved">
          <SavedList />
        </Section>

        <Section title="My posts">
          {posts.isError && <RequestError message="Could not load your posts." retry={() => void posts.refetch()} busy={posts.isFetching} />}
          <PostsList posts={posts.data} loading={posts.isPending} failed={posts.isError} />
        </Section>

        <Section title="My service">
          {service.isError && <RequestError message="Could not load your service." retry={() => void service.refetch()} busy={service.isFetching} />}
          {service.isPending ? null : myService ? (
            <Card padded={false}>
              <NavRow to={listingPath(myService.kind, myService.slug)} icon={<ChefHat size={20} aria-hidden="true" />} label={myService.name} />
            </Card>
          ) : !service.isError ? (
            <InlineEmpty icon={ChefHat} line="Do you bake, cook or run a vegan service? Showcase it here." action={{ label: 'Add it', to: '/add/service' }} />
          ) : null}
          {pendingClaims.map((c) => (
            <p key={c.id} className="px-2 text-sm text-muted">
              Claim for <Link className="font-bold text-ink" to={listingPath(c.listing.kind, c.listing.slug)}>{c.listing.name}</Link> is waiting. Your code: <span className="font-mono font-bold text-ink">{c.code}</span>
            </p>
          ))}
        </Section>

        <Section title="Theme">
          <Segmented<ThemeChoice>
            label="Theme"
            value={theme}
            onChange={chooseTheme}
            options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
          />
        </Section>

        <Section title="Account">
          <div className="flex flex-col">
            <NavRow icon={<KeyRound size={20} aria-hidden="true" />} label="Change password" onClick={() => setSheet('password')} />
            <NavRow to="/privacy" icon={<ShieldQuestion size={20} aria-hidden="true" />} label="Privacy" />
            {user.role === 'admin' && <NavRow to="/admin" icon={<ShieldCheck size={20} aria-hidden="true" />} label="Admin" />}
          </div>
        </Section>

        <div className="flex flex-col gap-3">
          <Button
            variant="secondary"
            block
            icon={<LogOut size={18} aria-hidden="true" />}
            busy={signOut.isPending}
            onClick={onSignOut}
          >
            Sign out
          </Button>
          {signOut.isError && (
            <RequestError message="Sign out did not finish. You are still signed in." retry={onSignOut} busy={signOut.isPending} />
          )}
          <Button variant="danger" block icon={<Trash2 size={18} aria-hidden="true" />} onClick={() => setSheet('delete')}>Delete account</Button>
        </div>
      </div>

      <EditProfileSheet open={sheet === 'edit'} onClose={() => setSheet(null)} profile={shown} />
      <PasswordSheet open={sheet === 'password'} onClose={() => setSheet(null)} />
      <DeleteAccountSheet
        open={sheet === 'delete'}
        onClose={() => setSheet(null)}
        onDeleted={() => {
          setSheet(null);
          toast.show({ success: true, message: 'Your account was deleted.' });
          navigate('/welcome', { replace: true });
        }}
      />
    </>
  );
}
