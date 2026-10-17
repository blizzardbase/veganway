import { MapPinOff } from 'lucide-react';
import { EmptyState, TopBar } from '../ui';

export function NotFound() {
  return (
    <>
      <TopBar title="Not found" back />
      <EmptyState icon={MapPinOff} line="This page does not exist." action={{ label: 'Go to Home', to: '/' }} />
    </>
  );
}
