import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { getCurrentLocation, pushLocation, requestPermissions, startForegroundTracking } from '../services/location';
import { useLocationStore } from '../stores/location';

type Status = 'idle' | 'loading' | 'ready' | 'denied' | 'unavailable';

// renova a presença no servidor mesmo parado (PRESENCE_TTL_S = 2 h no backend)
const KEEPALIVE_MS = 10 * 60_000;

// Pede permissão, pega a posição atual, publica presença no backend e guarda no store.
// `tracking`: acompanha a posição enquanto a tela está ativa (só primeiro plano — brief PRIVACIDADE §20).
export function useMyLocation(auto = true, tracking = false) {
  const lat = useLocationStore((s) => s.lat);
  const lng = useLocationStore((s) => s.lng);
  const setLocation = useLocationStore((s) => s.setLocation);
  const [status, setStatus] = useState<Status>(lat != null ? 'ready' : 'idle');

  const locate = useCallback(async () => {
    setStatus('loading');
    const ok = await requestPermissions();
    if (!ok) {
      setStatus('denied');
      return null;
    }
    const loc = await getCurrentLocation();
    if (!loc) {
      setStatus('unavailable');
      return null;
    }
    setLocation(loc.latitude, loc.longitude);
    setStatus('ready');
    pushLocation(loc).catch(() => {});
    return loc;
  }, [setLocation]);

  // renova o GPS em silêncio (sem mexer no status nem abrir diálogo): quem já tem posição em mãos
  const refresh = useCallback(async () => {
    const loc = await getCurrentLocation();
    if (!loc) return null;
    setLocation(loc.latitude, loc.longitude);
    pushLocation(loc).catch(() => {});
    return loc;
  }, [setLocation]);

  useEffect(() => {
    if (auto && lat == null && status === 'idle') locate();
  }, [auto, lat, status, locate]);

  // permissão negada: ao voltar pro app re-checa (o usuário pode ter liberado nos ajustes do sistema)
  useEffect(() => {
    if (status !== 'denied') return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      Location.getForegroundPermissionsAsync()
        .then((perm) => {
          if (perm.granted) locate();
        })
        .catch(() => {});
    });
    return () => sub.remove();
  }, [status, locate]);

  // acompanha a posição + keep-alive da presença; só com permissão já dada (nunca abre o diálogo daqui)
  const canTrack = tracking && lat != null && status !== 'denied';
  useEffect(() => {
    if (!canTrack) return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    Location.getForegroundPermissionsAsync()
      .then((perm) =>
        perm.granted
          ? startForegroundTracking((loc) => {
              setLocation(loc.latitude, loc.longitude);
              pushLocation(loc).catch(() => {});
            })
          : null,
      )
      .then((s) => {
        if (cancelled) s?.remove();
        else sub = s;
      })
      .catch(() => {});
    const timer = setInterval(() => {
      const cur = useLocationStore.getState();
      if (cur.lat != null && cur.lng != null) pushLocation({ latitude: cur.lat, longitude: cur.lng }).catch(() => {});
    }, KEEPALIVE_MS);
    return () => {
      cancelled = true;
      sub?.remove();
      clearInterval(timer);
    };
  }, [canTrack, setLocation]);

  return { lat, lng, status, locate, refresh };
}
