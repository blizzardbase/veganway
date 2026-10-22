// Report a listing. POST /api/reports belongs to the services, me and admin slice; this only calls it.
import { useState } from 'react';
import { Flag } from 'lucide-react';
import { Button, IconButton, Sheet, useToast } from '../../ui';
import { ApiError, errorMessage } from '../../api/client';
import { useRequireAccount } from '../auth/Gate';
import { useReport, type ReportDestination, type ReportReason } from './api';

const REASONS: { value: ReportReason; label: string }[] = [
  { value: 'wrong_info', label: 'Wrong or out of date' },
  { value: 'spam', label: 'Spam or advertising' },
  { value: 'offensive', label: 'Offensive' },
  { value: 'personal_info', label: 'Shares personal information' },
  { value: 'other', label: 'Something else' },
];

/** Report, as a flag icon in a detail page's top bar (the same place on every detail page) or as a text button. */
type ReportButtonProps = (
  | { targetType: 'listing' | 'recommendation' | 'photo'; targetId: string }
  | { targetType: 'photo'; photoUrl: string }
) & { variant?: 'icon' | 'text' };

export function ReportButton(props: ReportButtonProps) {
  const { targetType, variant = 'icon' } = props;
  const label = targetType === 'listing' ? 'Report' : `Report ${targetType}`;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const report = useReport();
  const toast = useToast();
  const requireAccount = useRequireAccount();

  const send = () => {
    if (!reason) return;
    const target: ReportDestination = 'photoUrl' in props
      ? { target_type: 'photo', photo_url: props.photoUrl }
      : { target_type: targetType, target_id: props.targetId };
    report.mutate({ ...target, reason }, {
      onSuccess: () => {
        setOpen(false);
        setReason(null);
        toast.show({ success: true, message: 'Thanks. An admin will take a look.' });
      },
      onError: (err) => {
        const message = err instanceof ApiError && err.status === 404 ? 'Reporting is not available yet.' : errorMessage(err);
        toast.show({ message });
      },
    });
  };

  return (
    <>
      {variant === 'icon' ? (
        <IconButton label={label} onClick={() => requireAccount(() => setOpen(true))}>
          <Flag size={20} aria-hidden="true" />
        </IconButton>
      ) : (
        <Button variant="ghost" size="md" icon={<Flag size={16} aria-hidden="true" />} onClick={() => requireAccount(() => setOpen(true))}>
          {label}
        </Button>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} title="What is wrong?">
        <div role="radiogroup" aria-label="Reason" className="flex flex-col gap-2 pb-4">
          {REASONS.map((r) => (
            <button
              key={r.value}
              type="button"
              role="radio"
              aria-checked={reason === r.value}
              onClick={() => setReason(r.value)}
              className="flex min-h-12 items-center rounded-input border border-line bg-surface px-4 text-left text-base font-semibold aria-checked:border-ink aria-checked:bg-surface-2 aria-checked:text-ink"
            >
              {r.label}
            </button>
          ))}
        </div>
        <Button block disabled={!reason} busy={report.isPending} busyLabel="Sending" onClick={send}>Send report</Button>
      </Sheet>
    </>
  );
}
