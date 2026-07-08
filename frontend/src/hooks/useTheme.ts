import { useEffect, useState } from 'react';

const KEY = 'dbwatch_theme';
type Theme = 'dark' | 'light';

// Persisted dark/light theme. Toggling adds/removes `.dark` on <html>,
// which flips every --color-* token defined in index.css.
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(KEY) as Theme) || 'dark'
  );

  useEffect(() => {
    const el = document.documentElement;
    el.classList.toggle('dark', theme === 'dark');
    localStorage.setItem(KEY, theme);
  }, [theme]);

  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  return { theme, toggle };
}
