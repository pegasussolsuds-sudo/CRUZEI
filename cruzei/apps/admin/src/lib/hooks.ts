import { useEffect, useState, type RefObject } from 'react';
import { readPref, writePref } from './prefs';

export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return v;
}

/** fecha menu/lista ao clicar fora ou apertar Esc */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, onDismiss: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, open, onDismiss]);
}

export type Theme = 'dark' | 'light';

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(currentTheme);
  const setTheme = (t: Theme) => {
    document.documentElement.dataset.theme = t;
    writePref('theme', t);
    setThemeState(t);
    // o mapa e os gráficos escutam pra trocar de estilo
    window.dispatchEvent(new CustomEvent('metch-admin:theme', { detail: t }));
  };
  return [theme, setTheme];
}

/** tema atual que reage à troca (pra componentes que desenham em canvas/SVG) */
export function useCurrentTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  useEffect(() => {
    const on = () => setTheme(currentTheme());
    window.addEventListener('metch-admin:theme', on);
    return () => window.removeEventListener('metch-admin:theme', on);
  }, []);
  return theme;
}

export function useCollapsedSidebar(): [boolean, (v: boolean) => void] {
  const [collapsed, setCollapsed] = useState(() => {
    const saved = readPref('sidebar', '');
    if (saved) return saved === 'collapsed';
    return window.matchMedia('(max-width: 1180px)').matches;
  });
  return [
    collapsed,
    (v: boolean) => {
      setCollapsed(v);
      writePref('sidebar', v ? 'collapsed' : 'open');
    },
  ];
}
