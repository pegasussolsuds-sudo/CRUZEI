import { create } from 'zustand';
import type { HiddenReason } from '@cruzei/shared-types';

interface LocationState {
  lat: number | null;
  lng: number | null;
  city: string | null;
  isAnonymous: boolean;
  /** o servidor decide se estou descoberto agora (área privada / residência / "ninguém" / anônimo) */
  discoverable: boolean;
  hiddenReason: HiddenReason | null;
  setLocation: (lat: number, lng: number, city?: string | null) => void;
  setAnonymous: (v: boolean) => void;
  setDiscoverable: (discoverable: boolean, hiddenReason: HiddenReason | null) => void;
}

// Só a MINHA posição vive aqui (memória, sem persistência). Nunca guardamos coordenada de outra pessoa no app.
export const useLocationStore = create<LocationState>((set) => ({
  lat: null,
  lng: null,
  city: null,
  isAnonymous: true,
  discoverable: true,
  hiddenReason: null,
  setLocation(lat, lng, city) {
    set({ lat, lng, city: city ?? null });
  },
  setAnonymous(v) {
    set({ isAnonymous: v });
  },
  setDiscoverable(discoverable, hiddenReason) {
    set({ discoverable, hiddenReason });
  },
}));
