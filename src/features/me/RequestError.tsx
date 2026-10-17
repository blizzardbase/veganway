import { Button } from '../../ui';

export function RequestError({ message, retry, busy }: { message: string; retry: () => void; busy: boolean }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2">
      <p className="text-sm text-danger">{message}</p>
      <Button variant="secondary" size="md" busy={busy} busyLabel="Retrying" onClick={retry}>Retry</Button>
    </div>
  );
}
