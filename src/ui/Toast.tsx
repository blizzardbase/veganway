import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, m } from 'motion/react';

export interface ToastInput {
  message: string;
  /** Shows an Undo button. Use on votes and deletes. */
  onUndo?: () => void;
  /** Milliseconds. Default 4000. */
  duration?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

interface ToastApi {
  show: (t: ToastInput) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast needs ToastProvider');
  return ctx;
}

/** One polite live region above the tab bar. Newest toast replaces older ones. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const show = useCallback((t: ToastInput) => {
    const id = nextId.current++;
    setItems([{ ...t, id }]);
    timers.current.set(id, setTimeout(() => dismiss(id), t.duration ?? 4000));
  }, [dismiss]);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-2 px-4"
        style={{ bottom: 'calc(var(--tabbar-h) + var(--safe-bottom) + 12px)' }}
      >
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <m.div
              key={t.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.18 }}
              className="pointer-events-auto flex w-full max-w-[528px] items-center gap-3 rounded-card bg-ink px-4 py-2 text-sm font-semibold text-bg shadow-3"
            >
              <span className="flex-1 py-2">{t.message}</span>
              {t.onUndo && (
                <button
                  type="button"
                  className="h-11 rounded-input bg-saffron px-3 font-extrabold text-on-saffron"
                  onClick={() => {
                    t.onUndo?.();
                    dismiss(t.id);
                  }}
                >
                  Undo
                </button>
              )}
            </m.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
