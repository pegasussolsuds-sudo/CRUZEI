import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { getCurrentLocation, pushLastFix, pushLocation, requestPermissions, startForegroundTracking } from '../services/location';
import { UNVERIFIED_MAX_RETRIES, UNVERIFIED_RETRY_MS } from '../services/locationFix';
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
  const unverified = useLocationStore((s) => s.hiddenReason === 'location_unverified');
  const [status, setStatus] = useState<Status>(lat != null ? 'ready' : 'idle');
  // pedido de permissão em andamento: o diálogo do sistema pode estar na tela (o tour do mapa não sobe por cima)
  const [asking, setAsking] = useState(false);

  const locate = useCallback(async () => {
    setStatus('loading');
    setAsking(true);
    let ok = false;
    try {
      ok = await requestPermissions();
    } finally {
      setAsking(false);
    }
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
    pushLocation(loc).catch(() => {}); // posição velha do cache do sistema não vai (pushLocation confere)
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
    // keep-alive com o último fix completo (precisão e "simulada" juntos — o servidor confere o GPS falso)
    const timer = setInterval(() => {
      pushLastFix().catch(() => {});
    }, KEEPALIVE_MS);
    return () => {
      cancelled = true;
      sub?.remove();
      clearInterval(timer);
    };
  }, [canTrack, setLocation]);

  // salto de posição ainda não confirmado pelo servidor ('location_unverified'): parado, o watch (50 m) não dispara —
  // manda um fix NOVO a cada ~50 s, até 3 vezes, pra confirmar a posição e voltar pro mapa
  useEffect(() => {
    if (!canTrack || !unverified) return;
    let tries = 0;
    let cancelled = false;
    const timer = setInterval(() => {
      if (tries >= UNVERIFIED_MAX_RETRIES) {
        clearInterval(timer);
        return;
      }
      tries += 1;
      getCurrentLocation()
        .then((loc) => {
          if (!loc || cancelled) return;
          setLocation(loc.latitude, loc.longitude);
          return pushLocation(loc);
        })
        .catch(() => {});
    }, UNVERIFIED_RETRY_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [canTrack, unverified, setLocation]);

  return { lat, lng, status, asking, locate, refresh };
}
