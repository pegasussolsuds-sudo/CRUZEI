import * as Location from 'expo-location';
import { encodeGeohash } from '@cruzei/shared-utils';
import type { LocationUpdateResponse } from '@cruzei/shared-types';
import { api, toApiError } from './api';
import { useLocationStore } from '../stores/location';
import { locationUpdateBody, toCruzeiLocation, type CruzeiLocation } from './locationFix';

export type { CruzeiLocation } from './locationFix';

// Só localização em PRIMEIRO PLANO (brief PRIVACIDADE §20): o Metch não coleta posição com o app fechado.
// A permissão de background foi removida do app.json/manifest de propósito.
export async function requestPermissions(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

export async function getCurrentLocation(): Promise<CruzeiLocation | null> {
  try {
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return toCruzeiLocation(pos);
  } catch {
    // GPS demorou/indisponível — tenta a última posição conhecida (com mais de 5 min vem marcada como velha: só a tela usa)
    try {
      const last = await Location.getLastKnownPositionAsync();
      if (!last) return null;
      return toCruzeiLocation(last, { lastKnown: true });
    } catch {
      return null;
    }
  }
}

export async function pushLocation(loc: CruzeiLocation): Promise<{ ok: boolean; geohash?: string; discoverable?: boolean }> {
  // posição velha do cache do sistema parece salto impossível pro servidor (GPS_GUARD): não manda
  if (loc.stale) return { ok: false };
  const body = locationUpdateBody(loc);
  // guarda o último fix completo (precisão, simulada) pro keep-alive e pros reenvios
  useLocationStore.getState().setLastFix(body);
  try {
    const res = await api.post<LocationUpdateResponse>('/location/update', body);
    // o servidor diz se estou descoberto aqui (área privada / residência / "ninguém" / GPS falso): o header avisa
    useLocationStore.getState().setDiscoverable(res.data.discoverable !== false, res.data.hiddenReason ?? null);
    return { ok: true, geohash: res.data.geohash, discoverable: res.data.discoverable };
  } catch (err) {
    const e = toApiError(err);
    // eslint-disable-next-line no-console
    console.warn('pushLocation failed:', e.message);
    return { ok: false };
  }
}

/** reenvia o último fix completo (keep-alive / presença sumiu); sem fix guardado, usa a posição da tela */
export function pushLastFix(): Promise<{ ok: boolean; geohash?: string; discoverable?: boolean }> {
  const cur = useLocationStore.getState();
  if (cur.lastFix) return pushLocation(cur.lastFix);
  if (cur.lat == null || cur.lng == null) return Promise.resolve({ ok: false });
  return pushLocation({ latitude: cur.lat, longitude: cur.lng });
}

export async function startForegroundTracking(
  onUpdate: (loc: CruzeiLocation) => void,
): Promise<Location.LocationSubscription | null> {
  // só confere: no Android, pedir (mesmo já concedida) abre a tela de permissão do sistema, o app pausa e volta,
  // o rastreamento religa e pede de novo — um laço infinito de pausa/retomada. Quem pede é o locate().
  const perm = await Location.getForegroundPermissionsAsync();
  if (!perm.granted) return null;
  return Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 50, // metros
      timeInterval: 30_000, // ms
    },
    (pos) => onUpdate(toCruzeiLocation(pos)),
  );
}

export function localGeohash(loc: CruzeiLocation, precision = 5): string {
  return encodeGeohash(loc.latitude, loc.longitude, precision);
}
