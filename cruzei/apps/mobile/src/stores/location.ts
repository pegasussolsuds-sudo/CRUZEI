import { create } from 'zustand';

interface LocationState {
  lat: number | null;
  lng: number | null;
  city: string | null;
  isAnonymous: boolean;
  setLocation: (lat: number, lng: number, city?: string | null) => void;
  setAnonymous: (v: boolean) => void;
}

export const useLocationStore = create<LocationState>((set) => ({
  lat: null,
  lng: null,
  city: null,
  isAnonymous: true,
  setLocation(lat, lng, city) {
    set({ lat, lng, city: city ?? null });
  },
  setAnonymous(v) {
    set({ isAnonymous: v });
  },
}));
