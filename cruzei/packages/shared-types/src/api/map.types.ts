// Map data endpoint — payload único que carrega tudo pro mapa

import type { NearbyUser, Hotspot, POI } from '../location';

export interface MapDataResponse {
  self: {
    latitude: number;
    longitude: number;
    geohash: string;
    visibilityMode: 'visible' | 'anonymous';
  };
  users: NearbyUser[];
  hotspots: Hotspot[];
  pois: POI[];
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
}
