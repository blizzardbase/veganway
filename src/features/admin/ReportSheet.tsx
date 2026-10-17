// Report anything: pick a reason, add an optional note. Signed out members go to Join first (the caller gates).
import { useState, type FormEvent } from 'react';
import { Button, Field, Sheet, useToast } from '../../ui';
import { errorMessage } from '../../api/client';
import { useReport } from './api';
import { REPORT_NOTE_MAX, REPORT_REASONS, REPORT_REASON_LABELS, type ReportReason, type ReportTarget } from '../../../shared/types/admin';
import { cx } from '../../lib/cx';

export interface ReportSheetProps {
  open: boolean;
  onClose: () => void;
  targetType: ReportTarget;
  targetId: string;
  /** What is being reported, for the title, e.g. "this service". */
  what?: string;
}

export function ReportSheet({ open, onClose, targetType, targetId, what = 'this' }: ReportSheetProps) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const report = useReport();
  const toast = useToast();

  const close = () => {
    setReason(null);
    setNote('');
    setError(null);
    onClose();
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reason) {
      setError('Pick a reason.');
      return;
    }
    try {
      await report.mutateAsync({ targetType, targetId, reason, note: note.trim() || undefined });
      toast.show({ message: 'Thanks. An admin will take a look.' });
      close();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Sheet open={open} onClose={close} title={`Report ${what}`}>
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-bold">What is wrong?</legend>
          {REPORT_REASONS.map((r) => (
            <label
              key={r}
              className={cx(
                'flex min-h-12 cursor-pointer items-center gap-3 rounded-input border px-4 text-base',
                reason === r ? 'border-brand bg-brand-soft' : 'border-line bg-surface',
              )}
            >
              <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="size-5 accent-brand" />
              {REPORT_REASON_LABELS[r]}
            </label>
          ))}
        </fieldset>
        <Field
          multiline
          label="Anything to add? (optional)"
          value={note}
          maxLength={REPORT_NOTE_MAX}
          onChange={(e) => setNote(e.target.value)}
          hint="Only admins see this."
        />
        {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
        <Button type="submit" block busy={report.isPending} busyLabel="Sending">Send report</Button>
      </form>
    </Sheet>
  );
}
