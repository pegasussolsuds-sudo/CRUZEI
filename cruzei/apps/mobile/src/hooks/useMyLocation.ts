import { useCallback, useEffect, useState } from 'react';
import { getCurrentLocation, pushLocation, requestPermissions } from '../services/location';
import { useLocationStore } from '../stores/location';

type Status = 'idle' | 'loading' | 'ready' | 'denied' | 'unavailable';

// Pede permissão, pega a posição atual, publica presença no backend e guarda no store.
export function useMyLocation(auto = true) {
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

  useEffect(() => {
    if (auto && lat == null && status === 'idle') locate();
  }, [auto, lat, status, locate]);

  return { lat, lng, status, locate };
}
