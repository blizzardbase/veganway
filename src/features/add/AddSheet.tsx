// The Add sheet: six tiles, each routing to a form owned by a slice (see AddRoute.tsx).
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { ChefHat, ChartColumnBig, MessagesSquare, ShoppingBasket, Store, Tag, type LucideIcon } from 'lucide-react';
import { Sheet } from '../../ui/Sheet';
import { useRequireAccount } from '../auth/Gate';

export type AddKind = 'place' | 'product' | 'offer' | 'service' | 'discussion' | 'poll';

export const ADD_TILES: { kind: AddKind; label: string; hint: string; icon: LucideIcon }[] = [
  { kind: 'place', label: 'Place', hint: 'Restaurant or cafe', icon: Store },
  { kind: 'product', label: 'Product', hint: 'Found in a shop', icon: ShoppingBasket },
  { kind: 'offer', label: 'Offer', hint: 'A deal right now', icon: Tag },
  { kind: 'service', label: 'Service', hint: 'Baker, cook, caterer', icon: ChefHat },
  { kind: 'discussion', label: 'Discussion', hint: 'Ask or share', icon: MessagesSquare },
  { kind: 'poll', label: 'Poll', hint: 'Let members vote', icon: ChartColumnBig },
];

interface AddSheetApi {
  openAdd: () => void;
}

const AddSheetContext = createContext<AddSheetApi | null>(null);

export function useAddSheet(): AddSheetApi {
  const ctx = useContext(AddSheetContext);
  if (!ctx) throw new Error('useAddSheet needs AddSheetProvider');
  return ctx;
}

export function AddSheetProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const requireAccount = useRequireAccount();
  const navigate = useNavigate();
  const openAdd = useCallback(() => {
    requireAccount(() => setOpen(true));
  }, [requireAccount]);
  const api = useMemo(() => ({ openAdd }), [openAdd]);

  return (
    <AddSheetContext.Provider value={api}>
      {children}
      <Sheet open={open} onClose={() => setOpen(false)} title="What would you like to add?">
        <ul className="grid grid-cols-2 gap-3 pt-1 pb-2">
          {ADD_TILES.map(({ kind, label, hint, icon: Icon }) => (
            <li key={kind}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  navigate(`/add/${kind}`);
                }}
                className="flex h-full min-h-24 w-full flex-col items-start gap-2 rounded-card border border-line bg-surface-2 p-4 text-left transition hover:border-brand active:scale-[0.98]"
              >
                <Icon size={24} className="text-brand" aria-hidden="true" />
                <span className="text-base font-extrabold">{label}</span>
                <span className="text-xs text-muted">{hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    </AddSheetContext.Provider>
  );
}
