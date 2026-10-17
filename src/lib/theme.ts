// Theme choice: system (default), light or dark. public/theme.js applies it before first paint.
import { useCallback, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'vw-theme';

export function readTheme(): ThemeChoice {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Storage blocked: the choice lasts for this visit only.
  }
}

export function useTheme(): [ThemeChoice, (t: ThemeChoice) => void] {
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);
  const set = useCallback((t: ThemeChoice) => {
    applyTheme(t);
    setTheme(t);
  }, []);
  return [theme, set];
}
