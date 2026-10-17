// Admin: plain and fast. Tabs Reports (with everything hidden now and banned members below), Claims, Listings (search and merge), Audit.
import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { EmptyState, Segmented, TopBar } from '../ui';
import { ListSkeleton } from '../ui/Skeleton';
import { useMe } from '../api/session';
import { AuditTab, ClaimsTab, HiddenSection, ListingsTab, ReportsTab } from '../features/admin/tabs';

type Tab = 'reports' | 'claims' | 'listings' | 'audit';

export function Admin() {
  const { data, isPending } = useMe();
  const [tab, setTab] = useState<Tab>('reports');
  const isAdmin = data?.user?.role === 'admin';

  if (isPending) {
    return (
      <>
        <TopBar title="Admin" back />
        <ListSkeleton count={3} />
      </>
    );
  }
  if (!isAdmin) {
    return (
      <>
        <TopBar title="Admin" back />
        <EmptyState icon={ShieldCheck} line="This page is for group admins." action={{ label: 'Back to Home', to: '/' }} />
      </>
    );
  }

  return (
    <>
      <TopBar title="Admin" back />
      <Segmented<Tab>
        label="Admin sections"
        value={tab}
        onChange={setTab}
        className="mb-4"
        options={[
          { value: 'reports', label: 'Reports' },
          { value: 'claims', label: 'Claims' },
          { value: 'listings', label: 'Listings' },
          { value: 'audit', label: 'Audit' },
        ]}
      />
      {tab === 'reports' && (
        <div className="flex flex-col gap-8">
          <ReportsTab />
          <HiddenSection />
        </div>
      )}
      {tab === 'claims' && <ClaimsTab />}
      {tab === 'listings' && <ListingsTab />}
      {tab === 'audit' && <AuditTab />}
    </>
  );
}
