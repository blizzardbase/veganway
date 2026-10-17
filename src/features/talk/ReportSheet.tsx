// Report a topic or reply. Calls POST /api/reports, which the admin slice owns.
import { useState } from 'react';
import { errorMessage } from '../../api/client';
import { Button, Sheet, useToast } from '../../ui';
import { cx } from '../../lib/cx';
import { useReport } from './api';

const REASONS = [
  { value: 'spam', label: 'Spam or advertising' },
  { value: 'wrong_info', label: 'Wrong information' },
  { value: 'offensive', label: 'Offensive or unkind' },
  { value: 'personal_info', label: 'Shares personal details' },
  { value: 'other', label: 'Something else' },
] as const;

export interface ReportTarget {
  type: 'topic' | 'reply';
  id: string;
}

export function ReportSheet({ target, onClose }: { target: ReportTarget | null; onClose: () => void }) {
  const [reason, setReason] = useState<string | null>(null);
  const report = useReport();
  const toast = useToast();

  const close = () => {
    setReason(null);
    report.reset();
    onClose();
  };

  const send = () => {
    if (!target || !reason) return;
    report.mutate({ target_type: target.type, target_id: target.id, reason }, {
      onSuccess: () => {
        toast.show({ message: 'Thanks. An admin will take a look.' });
        close();
      },
    });
  };

  return (
    <Sheet open={target !== null} onClose={close} title={target?.type === 'reply' ? 'Report this reply' : 'Report this discussion'}>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm text-muted">What is wrong with it?</legend>
        {REASONS.map((r) => (
          <label
            key={r.value}
            className={cx(
              'flex min-h-12 cursor-pointer items-center gap-3 rounded-input border px-4 text-base font-semibold transition',
              reason === r.value ? 'border-brand bg-brand-soft' : 'border-line bg-surface',
            )}
          >
            <input type="radio" name="report-reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} className="size-5 accent-[var(--color-brand)]" />
            {r.label}
          </label>
        ))}
      </fieldset>
      {report.isError && <p role="alert" className="mt-3 text-sm font-semibold text-danger">{errorMessage(report.error)}</p>}
      <Button block className="mt-4" disabled={!reason} busy={report.isPending} busyLabel="Sending" onClick={send}>Send report</Button>
    </Sheet>
  );
}
