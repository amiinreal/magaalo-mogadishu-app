import { BOUNDS } from '../config';

export type LngLat = [number, number];
export type Point = { lat: number; lng: number };

export function inside(lng: number, lat: number) {
  return Number.isFinite(lng) && Number.isFinite(lat) &&
    lng >= BOUNDS.west && lng <= BOUNDS.east && lat >= BOUNDS.south && lat <= BOUNDS.north;
}

export function metersBetween(a: LngLat, b: LngLat) {
  const rad = Math.PI / 180, lat = ((a[1] + b[1]) / 2) * rad;
  return Math.hypot((a[0] - b[0]) * 111320 * Math.cos(lat), (a[1] - b[1]) * 111320);
}

export function decodePolyline(text: string, precision = 6): LngLat[] {
  const points: LngLat[] = [], factor = 10 ** precision;
  let index = 0, lat = 0, lng = 0;
  const next = () => {
    let result = 0, shift = 0, b: number;
    do { b = text.charCodeAt(index++) - 63; result |= (b & 31) << shift; shift += 5; } while (b >= 32);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < text.length) { lat += next(); lng += next(); points.push([lng / factor, lat / factor]); }
  return points;
}

/** Snap a position to the route polyline, searching forward from the last known segment. */
export function routeProgress(point: LngLat, coords: LngLat[], startIndex = 0) {
  let distance = Infinity, index = startIndex, snap: LngLat = coords[0];
  for (let i = Math.max(0, startIndex - 4); i < coords.length - 1; i++) {
    const a = coords[i], b = coords[i + 1], dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    const p: LngLat = [a[0] + t * dx, a[1] + t * dy], d = metersBetween(point, p);
    if (d < distance) { distance = d; index = i; snap = p; }
  }
  return { index, distance, snap };
}

/** Remaining length of the route from a snapped position. */
export function remainingMeters(coords: LngLat[], index: number, snap: LngLat) {
  let total = metersBetween(snap, coords[Math.min(index + 1, coords.length - 1)]);
  for (let i = index + 1; i < coords.length - 1; i++) total += metersBetween(coords[i], coords[i + 1]);
  return total;
}

/** Point at `meters` along a polyline (used by the navigation simulator). */
export function pointAlong(coords: LngLat[], meters: number): { point: LngLat; bearing: number; done: boolean } {
  let left = meters;
  for (let i = 0; i < coords.length - 1; i++) {
    const seg = metersBetween(coords[i], coords[i + 1]);
    if (left <= seg) {
      const t = seg ? left / seg : 0, a = coords[i], b = coords[i + 1];
      return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], bearing: bearing(a, b), done: false };
    }
    left -= seg;
  }
  const last = coords[coords.length - 1];
  return { point: last, bearing: 0, done: true };
}

export function bearing(a: LngLat, b: LngLat) {
  const rad = Math.PI / 180, y = Math.sin((b[0] - a[0]) * rad) * Math.cos(b[1] * rad);
  const x = Math.cos(a[1] * rad) * Math.sin(b[1] * rad) - Math.sin(a[1] * rad) * Math.cos(b[1] * rad) * Math.cos((b[0] - a[0]) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

/** Shortest distance (m) from a point to any segment of a polyline. */
export function distanceToLine(point: LngLat, coords: LngLat[]) {
  return coords.length > 1 ? routeProgress(point, coords, 0).distance : Infinity;
}

/** A small square polygon (lng/lat ring) around a point, for routing exclusions. */
export function squareAround(lng: number, lat: number, meters: number): LngLat[] {
  const dLat = meters / 111320, dLng = meters / (111320 * Math.cos((lat * Math.PI) / 180));
  return [[lng - dLng, lat - dLat], [lng + dLng, lat - dLat], [lng + dLng, lat + dLat], [lng - dLng, lat + dLat], [lng - dLng, lat - dLat]];
}
