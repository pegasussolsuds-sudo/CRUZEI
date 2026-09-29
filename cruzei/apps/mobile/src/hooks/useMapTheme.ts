import { useEffect, useState } from 'react';
import { AppState, Linking } from 'react-native';
import { create } from 'zustand';
import type { MapTheme } from '../screens/map/bridge';

// Tema do mapa por hora local: dusk 17:00–18:59, night 19:00–05:59, day o resto.
// O modo anônimo NÃO influencia o tema (anônimo vê tudo; só o marcador próprio vira silhueta).
export function themeForHour(hour: number): MapTheme {
  if (hour >= 17 && hour < 19) return 'dusk';
  if (hour >= 19 || hour < 6) return 'night';
  return 'day';
}

function currentAutoTheme(): MapTheme {
  return themeForHour(new Date().getHours());
}

interface MapThemeOverrideState {
  /** override em memória (ex.: Premium+ forçando 'night'); null = automático por hora */
  override: MapTheme | null;
  setOverride: (theme: MapTheme | null) => void;
}

export const useMapThemeOverride = create<MapThemeOverrideState>((set) => ({
  override: null,
  setOverride(theme) {
    set({ override: theme });
  },
}));

// Só em desenvolvimento: força o tema pra testar sem mexer no relógio do aparelho.
//   adb shell am start -a android.intent.action.VIEW -d "metch://dev/theme/day" app.metch   (day | dusk | night | auto)
if (__DEV__) {
  const applyDevTheme = (url: string | null) => {
    const m = url ? /^metch:\/\/dev\/theme\/(day|dusk|night|auto)\b/.exec(url) : null;
    if (m) useMapThemeOverride.getState().setOverride(m[1] === 'auto' ? null : (m[1] as MapTheme));
  };
  Linking.addEventListener('url', (e) => applyDevTheme(e.url));
  Linking.getInitialURL()
    .then(applyDevTheme)
    .catch(() => {});
}

export function useMapTheme(): {
  theme: MapTheme;
  autoTheme: MapTheme;
  override: MapTheme | null;
  setOverride: (theme: MapTheme | null) => void;
} {
  const override = useMapThemeOverride((s) => s.override);
  const setOverride = useMapThemeOverride((s) => s.setOverride);
  const [autoTheme, setAutoTheme] = useState<MapTheme>(currentAutoTheme);

  useEffect(() => {
    const tick = () => setAutoTheme(currentAutoTheme());
    const interval = setInterval(tick, 60_000);
    // voltando do background o relógio pode ter cruzado 17h/19h/6h
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') tick();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, []);

  return { theme: override ?? autoTheme, autoTheme, override, setOverride };
}
