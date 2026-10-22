import { Suspense } from 'react';
import { Outlet, ScrollRestoration, useLocation, useOutlet } from 'react-router';
import { LayoutGroup, m, LazyMotion, MotionConfig } from 'motion/react';
import { ToastProvider } from '../ui/Toast';
import { TabBar } from '../ui/TabBar';
import { ListSkeleton } from '../ui/Skeleton';
import { AddSheetProvider, useAddSheet } from '../features/add/AddSheet';
import { cx } from '../lib/cx';

const loadLayoutMotion = () => import('../lib/layoutFeatures').then((mod) => mod.default);
const loadMotion = () => import('../lib/motionFeatures').then((mod) => mod.default);

function PageFallback() {
  return <div className="pt-16"><ListSkeleton count={3} /></div>;
}

/** Every route: motion features, reduced motion respected, toasts, scroll restoration. */
export function RootLayout() {
  const { pathname } = useLocation();
  const listingMotion = /^\/(?:explore|places|products|services|me)(?:\/|$)/.test(pathname);
  return (
    <LazyMotion features={listingMotion ? loadLayoutMotion : loadMotion} strict>
      <MotionConfig reducedMotion="user">
        <ToastProvider>
          <LayoutGroup><Outlet /></LayoutGroup>
          <ScrollRestoration />
        </ToastProvider>
      </MotionConfig>
    </LazyMotion>
  );
}

function TabBarWithAdd() {
  const { openAdd } = useAddSheet();
  return <TabBar onAdd={openAdd} />;
}

/**
 * Detail pages (a place, product, service or topic) and Add forms drop the tab bar and the raised
 * Add button: each shows a top bar with Back and one sticky bar of its own at the bottom.
 */
const NO_TAB_BAR = /^\/(?:(?:places|products|services|talk|add)\/[^/]+)\/?$/;

export function isDetailPath(pathname: string): boolean {
  return NO_TAB_BAR.test(pathname);
}

/** The five tab roots, Search, Me and the other plain screens keep the bottom tab bar. */
export function TabLayout() {
  const { pathname } = useLocation();
  const detail = isDetailPath(pathname);
  const outlet = useOutlet();
  return (
    <AddSheetProvider>
      <main className={cx('page-surface mx-auto w-full max-w-[560px] px-4', detail ? 'pb-actionbar' : 'pb-tabbar')}>
        <m.div key={pathname} className="route-content" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.16 }}>
          <Suspense fallback={<PageFallback />}>{outlet}</Suspense>
        </m.div>
      </main>
      {!detail && <TabBarWithAdd />}
    </AddSheetProvider>
  );
}

/** Welcome, Join, Sign in and password reset: one narrow column, no tab bar. */
export function AuthLayout() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-4 pb-[calc(24px+var(--safe-bottom))]">
      <Suspense fallback={<PageFallback />}>
        <Outlet />
      </Suspense>
    </main>
  );
}
