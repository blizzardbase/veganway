// "This is my business": explains the WhatsApp code step, then shows the code.
import { Copy } from 'lucide-react';
import { Button, Sheet, useToast } from '../../ui';
import { errorMessage } from '../../api/client';
import { useClaim } from './api';
import type { MyClaim } from '../../../shared/types/services';

export function ClaimSheet({ open, onClose, listingId, slug, name, claim }: {
  open: boolean;
  onClose: () => void;
  listingId: string;
  slug: string;
  name: string;
  claim: MyClaim | null;
}) {
  const doClaim = useClaim(slug);
  const toast = useToast();
  const pending = claim?.status === 'pending' ? claim : doClaim.data?.claim ?? null;

  return (
    <Sheet open={open} onClose={onClose} title="This is my business">
      {pending ? (
        <div className="flex flex-col gap-4">
          <p className="text-base">Your code for {name}:</p>
          <p data-testid="claim-code" className="rounded-card bg-surface-2 py-4 text-center font-mono text-2xl font-extrabold tracking-widest">{pending.code}</p>
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-base">
            <li>Send this code to a group admin on WhatsApp.</li>
            <li>Send it from the number the group knows for your business.</li>
            <li>When the admin approves, you can edit this page and add your contact links.</li>
          </ol>
          <Button
            variant="secondary"
            block
            icon={<Copy size={18} aria-hidden="true" />}
            onClick={() => {
              void navigator.clipboard?.writeText(pending.code).then(
                () => toast.show({ message: 'Code copied.' }),
                () => toast.show({ message: 'Could not copy. Please write the code down.' }),
              );
            }}
          >
            Copy code
          </Button>
          <Button block onClick={onClose}>Done</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-base">Run {name}? Claim this page to edit it, add your contact links and show a Run by owner badge.</p>
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-base">
            <li>We give you a short code that starts with VW.</li>
            <li>You send the code to a group admin on WhatsApp.</li>
            <li>The admin checks it and approves your claim.</li>
          </ol>
          <p className="text-sm text-muted">Owners can never hide what members say about their business.</p>
          {doClaim.error && <p role="alert" className="text-sm font-semibold text-danger">{errorMessage(doClaim.error)}</p>}
          <Button block busy={doClaim.isPending} busyLabel="Making your code" onClick={() => doClaim.mutate(listingId)}>Get my code</Button>
        </div>
      )}
    </Sheet>
  );
}
