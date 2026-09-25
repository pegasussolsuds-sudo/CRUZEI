import * as Location from 'expo-location';
import { encodeGeohash } from '@cruzei/shared-utils';
import type { LocationUpdateResponse } from '@cruzei/shared-types';
import { api, toApiError } from './api';
import { useLocationStore } from '../stores/location';

export type CruzeiLocation = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
};

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
    return {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracyMeters: Math.round(pos.coords.accuracy ?? 0),
    };
  } catch {
    // GPS demorou/indisponível — tenta a última posição conhecida
    try {
      const last = await Location.getLastKnownPositionAsync();
      if (!last) return null;
      return {
        latitude: last.coords.latitude,
        longitude: last.coords.longitude,
        accuracyMeters: Math.round(last.coords.accuracy ?? 0),
      };
    } catch {
      return null;
    }
  }
}

export async function pushLocation(loc: CruzeiLocation): Promise<{ ok: boolean; geohash?: string; discoverable?: boolean }> {
  try {
    const res = await api.post<LocationUpdateResponse>('/location/update', loc);
    // o servidor diz se estou descoberto aqui (área privada / residência / "ninguém"): o header avisa
    useLocationStore.getState().setDiscoverable(res.data.discoverable !== false, res.data.hiddenReason ?? null);
    return { ok: true, geohash: res.data.geohash, discoverable: res.data.discoverable };
  } catch (err) {
    const e = toApiError(err);
    // eslint-disable-next-line no-console
    console.warn('pushLocation failed:', e.message);
    return { ok: false };
  }
}

export async function startForegroundTracking(
  onUpdate: (loc: CruzeiLocation) => void,
): Promise<Location.LocationSubscription | null> {
  const hasPerm = await requestPermissions();
  if (!hasPerm) return null;
  return Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 50, // metros
      timeInterval: 30_000, // ms
    },
    (pos) =>
      onUpdate({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracyMeters: Math.round(pos.coords.accuracy ?? 0),
      }),
  );
}

export function localGeohash(loc: CruzeiLocation, precision = 5): string {
  return encodeGeohash(loc.latitude, loc.longitude, precision);
}
