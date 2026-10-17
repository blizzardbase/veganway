import { Suspense } from 'react';
import { Outlet, ScrollRestoration, useLocation } from 'react-router';
import { LazyMotion, MotionConfig } from 'motion/react';
import { ToastProvider } from '../ui/Toast';
import { TabBar } from '../ui/TabBar';
import { ListSkeleton } from '../ui/Skeleton';
import { AddSheetProvider, useAddSheet } from '../features/add/AddSheet';
import { cx } from '../lib/cx';

const loadMotion = () => import('../lib/motionFeatures').then((mod) => mod.default);

function PageFallback() {
  return <div className="pt-16"><ListSkeleton count={3} /></div>;
}

/** Every route: motion features, reduced motion respected, toasts, scroll restoration. */
export function RootLayout() {
  return (
    <LazyMotion features={loadMotion} strict>
      <MotionConfig reducedMotion="user">
        <ToastProvider>
          <Outlet />
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
  return (
    <AddSheetProvider>
      <main className={cx('mx-auto w-full max-w-[560px] px-4', detail ? 'pb-actionbar' : 'pb-tabbar')}>
        <Suspense fallback={<PageFallback />}>
          <Outlet />
        </Suspense>
      </main>
      {!detail && <TabBarWithAdd />}
    </AddSheetProvider>
  );
}

/** Welcome, Join, Recovery, Sign in and Reset: one narrow column, no tab bar. */
export function AuthLayout() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-4 pb-[calc(24px+var(--safe-bottom))]">
      <Suspense fallback={<PageFallback />}>
        <Outlet />
      </Suspense>
    </main>
  );
}
