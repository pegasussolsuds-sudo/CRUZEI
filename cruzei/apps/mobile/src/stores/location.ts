import { create } from 'zustand';
import type { HiddenReason } from '@cruzei/shared-types';

/** último fix enviado (como vai pro POST /location/update): keep-alive e reenvios mandam precisão e "simulada" junto */
export interface LastFix {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  mocked?: true;
}

interface LocationState {
  lat: number | null;
  lng: number | null;
  city: string | null;
  isAnonymous: boolean;
  /** o servidor decide se estou descoberto agora (área privada / residência / "ninguém" / anônimo / GPS falso) */
  discoverable: boolean;
  hiddenReason: HiddenReason | null;
  lastFix: LastFix | null;
  setLocation: (lat: number, lng: number, city?: string | null) => void;
  setAnonymous: (v: boolean) => void;
  setDiscoverable: (discoverable: boolean, hiddenReason: HiddenReason | null) => void;
  setLastFix: (fix: LastFix) => void;
}

// Só a MINHA posição vive aqui (memória, sem persistência). Nunca guardamos coordenada de outra pessoa no app.
export const useLocationStore = create<LocationState>((set) => ({
  lat: null,
  lng: null,
  city: null,
  isAnonymous: true,
  discoverable: true,
  hiddenReason: null,
  lastFix: null,
  setLocation(lat, lng, city) {
    set({ lat, lng, city: city ?? null });
  },
  setAnonymous(v) {
    set({ isAnonymous: v });
  },
  setDiscoverable(discoverable, hiddenReason) {
    set({ discoverable, hiddenReason });
  },
  setLastFix(fix) {
    set({ lastFix: fix });
  },
}));
