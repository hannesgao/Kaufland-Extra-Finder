import type { LatLng } from "./data";

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in km (haversine). */
export function distanceKm([lat1, lng1]: LatLng, [lat2, lng2]: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

const kmFormat = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

/** "3,2 km", "< 0,1 km" */
export function formatKm(km: number): string {
  return km < 0.1 ? "< 0,1 km" : `${kmFormat.format(km)} km`;
}
