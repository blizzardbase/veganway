// Browsing is open to everyone. Acting (adding, voting, replying, saving) needs an account.
// Signed out members who try to act go to Join, and come back to where they were afterwards.
import { useCallback, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useMe } from '../../api/session';
import { ListSkeleton } from '../../ui/Skeleton';

/** Only same app paths are allowed as a return target. */
export function safeNext(next: string | null | undefined, fallback = '/'): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : fallback;
}

export function joinPath(next: string): string {
  return `/join?next=${encodeURIComponent(next)}`;
}

/**
 * Returns requireAccount(action?). Signed in: runs action and returns true.
 * Signed out: navigates to Join with a return path and returns false.
 */
export function useRequireAccount(): (action?: () => void) => boolean {
  const { data } = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback((action?: () => void) => {
    if (data?.user) {
      action?.();
      return true;
    }
    navigate(joinPath(location.pathname + location.search));
    return false;
  }, [data, navigate, location.pathname, location.search]);
}

/** Wrap a route whose whole purpose is acting, such as an Add form. */
export function RequireAccount({ children }: { children: ReactNode }) {
  const { data, isPending } = useMe();
  const location = useLocation();
  if (isPending) return <div className="pt-4"><ListSkeleton count={2} /></div>;
  if (!data?.user) return <Navigate to={joinPath(location.pathname + location.search)} replace />;
  return <>{children}</>;
}
