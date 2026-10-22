import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { ChevronLeft } from 'lucide-react';
import { IconButton } from './IconButton';

/** History back when there is somewhere in the app to go back to; otherwise the parent screen. */
export function useBack(fallback = '/'): () => void {
  const navigate = useNavigate();
  return () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  };
}

/**
 * A screen header: optional back button, a title, and optional actions on the right.
 * `back` is true (fallback Home) or the parent path to use when there is no history, for example
 * after opening a shared link straight to a detail page.
 */
export function TopBar({ title, back, actions, compactTitle }: { title?: string; back?: boolean | string; actions?: ReactNode; compactTitle?: ReactNode }) {
  const [condensed, setCondensed] = useState(false);
  useEffect(() => {
    const update = () => setCondensed(window.scrollY > 24);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);
  const goBack = useBack(typeof back === 'string' ? back : '/');
  return (
    <header className={`page-header ${condensed ? 'is-condensed' : ''} sticky top-0 z-30 -mx-4 mb-2 flex h-14 items-center gap-1 bg-bg/95 px-2 backdrop-blur`}>
      {back && (
        <IconButton label="Back" onClick={goBack}>
          <ChevronLeft size={26} aria-hidden="true" />
        </IconButton>
      )}
      {title ? <h1 className="min-w-0 flex-1 truncate px-2 text-xl font-extrabold">{title}</h1> : <div className="min-w-0 flex-1">{compactTitle}</div>}
      {actions}
    </header>
  );
}
