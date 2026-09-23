// Haversine — distância em metros entre dois pontos lat/lng

const EARTH_RADIUS_M = 6_371_000;

export function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

export interface BBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

// Bounding box aproximado em volta de um ponto central com raio em metros
export function bboxAround(lat: number, lng: number, radiusM: number): BBox {
  const dLat = radiusM / 111_320; // ~ metros por grau de latitude
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return {
    north: lat + dLat,
    south: lat - dLat,
    east: lng + dLng,
    west: lng - dLng,
  };
}
