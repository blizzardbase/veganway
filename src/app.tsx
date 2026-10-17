// Routes for every screen in spec section 6. Home and the auth screens (Welcome first, for everyone
// arriving from the WhatsApp link) ship in the first load, so the first screen needs no second round
// trip. Every other screen loads lazily. Add forms route through /add/:kind (AddRoute).
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { createBrowserRouter, Navigate, useRouteError } from 'react-router';
import { TriangleAlert } from 'lucide-react';
import { AuthLayout, RootLayout, TabLayout } from './layout/layouts';
import { useMe } from './api/session';
import { isBrowsing } from './features/auth/browse';
import { AddRoute } from './features/add/AddRoute';
import { NotFound } from './screens/NotFound';
import { EmptyState } from './ui/EmptyState';
import { ListSkeleton } from './ui/Skeleton';
import { Home } from './screens/Home';
import { Welcome } from './screens/Welcome';
import { Join } from './screens/Join';
import { Recovery } from './screens/Recovery';
import { ServiceQuestion } from './screens/ServiceQuestion';
import { SignIn } from './screens/SignIn';
import { Reset } from './screens/Reset';

function lazyScreen<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K): LazyExoticComponent<ComponentType> {
  return lazy(async () => {
    const screen: ComponentType = (await load())[name];
    return { default: screen };
  });
}

/** A route element for a lazily loaded screen. Called once per route, at module load. */
function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  const Component = lazyScreen(load, name);
  return <Component />;
}

/** Home for members and for visitors who chose to look around; Welcome for first time visitors. */
function HomeEntry() {
  const { data, isPending } = useMe();
  if (isPending) return <div className="pt-16"><ListSkeleton count={3} /></div>;
  if (!data?.user && !isBrowsing()) return <Navigate to="/welcome" replace />;
  return <Home />;
}

function RouteError() {
  const error = useRouteError();
  if (import.meta.env.DEV) console.error(error);
  return (
    <main className="mx-auto max-w-[560px] px-4 pt-16">
      <EmptyState icon={TriangleAlert} line="Something went wrong. Please reload the page." action={{ label: 'Reload', onClick: () => window.location.reload() }} />
    </main>
  );
}

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    errorElement: <RouteError />,
    children: [
      {
        element: <AuthLayout />,
        children: [
          { path: 'welcome', element: <Welcome /> },
          { path: 'join', element: <Join /> },
          { path: 'join/recovery', element: <Recovery /> },
          { path: 'join/service', element: <ServiceQuestion /> },
          { path: 'signin', element: <SignIn /> },
          { path: 'reset', element: <Reset /> },
        ],
      },
      {
        element: <TabLayout />,
        children: [
          { index: true, element: <HomeEntry /> },
          { path: 'explore', element: page(() => import('./screens/Explore'), 'Explore') },
          { path: 'places/:slug', element: page(() => import('./screens/ListingDetail'), 'ListingDetail') },
          { path: 'products/:slug', element: page(() => import('./screens/ListingDetail'), 'ListingDetail') },
          { path: 'services/:slug', element: page(() => import('./screens/ServiceProfile'), 'ServiceProfile') },
          { path: 'talk', element: page(() => import('./screens/Talk'), 'Talk') },
          { path: 'talk/:id', element: page(() => import('./screens/Topic'), 'Topic') },
          { path: 'search', element: page(() => import('./screens/Search'), 'Search') },
          { path: 'me', element: page(() => import('./screens/Me'), 'Me') },
          { path: 'privacy', element: page(() => import('./screens/Privacy'), 'Privacy') },
          { path: 'admin', element: page(() => import('./screens/Admin'), 'Admin') },
          { path: 'add/:kind', element: <AddRoute /> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);
