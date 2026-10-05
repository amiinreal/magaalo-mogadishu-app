import { OSRM_URL, VALHALLA_URL } from '../config';
import { decodePolyline, distanceToLine, routeProgress, squareAround, type LngLat, type Point } from './geo';
import type { MapAlert } from './community';

export type Mode = 'driving' | 'walking' | 'cycling';
export type StepKind = 'depart' | 'turn' | 'continue' | 'roundabout' | 'keep' | 'merge' | 'arrive';
export type Modifier = 'left' | 'right' | 'slight left' | 'slight right' | 'sharp left' | 'sharp right' | 'uturn' | 'straight';

export type Step = {
  kind: StepKind;
  modifier?: Modifier;
  street?: string;
  exit?: number;
  bearingAfter?: number;
  distance: number;
  location: LngLat;
  routeIndex: number;
};

export type Route = {
  coords: LngLat[];
  distance: number;
  duration: number;
  steps: Step[];
  avoided: number;
  provider: 'valhalla' | 'osrm';
};

const COSTING: Record<Mode, string> = { driving: 'auto', walking: 'pedestrian', cycling: 'bicycle' };
const TIMEOUT = 20000;

async function fetchJSON(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error || `Routing failed (${response.status})`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

// Valhalla maneuver type → our step vocabulary.
function valhallaStep(type: number): { kind: StepKind; modifier?: Modifier } {
  switch (type) {
    case 1: case 2: case 3: return { kind: 'depart' };
    case 4: return { kind: 'arrive' };
    case 5: return { kind: 'arrive', modifier: 'right' };
    case 6: return { kind: 'arrive', modifier: 'left' };
    case 9: case 18: return { kind: 'turn', modifier: 'slight right' };
    case 10: return { kind: 'turn', modifier: 'right' };
    case 11: return { kind: 'turn', modifier: 'sharp right' };
    case 12: case 13: return { kind: 'turn', modifier: 'uturn' };
    case 14: return { kind: 'turn', modifier: 'sharp left' };
    case 15: return { kind: 'turn', modifier: 'left' };
    case 16: case 19: return { kind: 'turn', modifier: 'slight left' };
    case 20: case 23: return { kind: 'keep', modifier: 'right' };
    case 21: case 24: return { kind: 'keep', modifier: 'left' };
    case 25: case 37: case 38: return { kind: 'merge' };
    case 26: return { kind: 'roundabout' };
    default: return { kind: 'continue' };
  }
}

type ValhallaTrip = {
  legs: { shape: string; maneuvers: { type: number; street_names?: string[]; length: number; begin_shape_index: number; roundabout_exit_count?: number; bearing_after?: number }[] }[];
  summary: { length: number; time: number };
};

function fromValhalla(trip: ValhallaTrip): Route {
  const coords: LngLat[] = [], steps: Step[] = [];
  for (const leg of trip.legs) {
    const shape = decodePolyline(leg.shape, 6), offset = coords.length;
    coords.push(...shape);
    for (const m of leg.maneuvers) {
      if (m.type === 27) continue; // "exit roundabout" is folded into the roundabout step
      const { kind, modifier } = valhallaStep(m.type);
      steps.push({
        kind, modifier, street: m.street_names?.[0], exit: m.roundabout_exit_count, bearingAfter: m.bearing_after,
        distance: m.length * 1000, location: shape[m.begin_shape_index], routeIndex: offset + m.begin_shape_index,
      });
    }
  }
  return { coords, distance: trip.summary.length * 1000, duration: trip.summary.time, steps, avoided: 0, provider: 'valhalla' };
}

type OsrmRoute = {
  distance: number; duration: number; geometry: { coordinates: LngLat[] };
  legs: { steps: { name: string; distance: number; maneuver: { type: string; modifier?: Modifier; location: LngLat; exit?: number; bearing_after?: number } }[] }[];
};

function fromOsrm(route: OsrmRoute, mode: Mode): Route {
  const coords = route.geometry.coordinates;
  let previous = 0;
  const steps = route.legs.flatMap(leg => leg.steps).flatMap((s): Step[] => {
    const type = s.maneuver.type;
    if (type === 'exit roundabout' || type === 'exit rotary') return [];
    const kind: StepKind = type === 'depart' ? 'depart' : type === 'arrive' ? 'arrive'
      : type === 'roundabout' || type === 'rotary' ? 'roundabout' : type === 'merge' ? 'merge'
      : type === 'fork' ? 'keep' : type === 'continue' || type === 'new name' ? 'continue' : 'turn';
    const match = routeProgress(s.maneuver.location, coords, previous);
    previous = match.index;
    return [{
      kind, modifier: s.maneuver.modifier, street: s.name || undefined, exit: s.maneuver.exit,
      bearingAfter: s.maneuver.bearing_after, distance: s.distance, location: s.maneuver.location, routeIndex: match.index,
    }];
  });
  // The public OSRM server only has a car profile; estimate walking/cycling time from distance.
  const duration = mode === 'walking' ? route.distance / 1.3 : mode === 'cycling' ? route.distance / 4.2 : route.duration;
  return { coords, distance: route.distance, duration, steps, avoided: 0, provider: 'osrm' };
}

async function valhalla(from: Point, to: Point, mode: Mode, exclusions: LngLat[][], alternates: number) {
  const body = {
    locations: [{ lat: from.lat, lon: from.lng }, { lat: to.lat, lon: to.lng }],
    costing: COSTING[mode],
    alternates,
    units: 'kilometers',
    ...(exclusions.length ? { exclude_polygons: exclusions } : {}),
  };
  const data = await fetchJSON(VALHALLA_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return [data.trip, ...(data.alternates ?? []).map((a: { trip: ValhallaTrip }) => a.trip)].map(fromValhalla);
}

async function osrm(from: Point, to: Point, mode: Mode) {
  const url = `${OSRM_URL}/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true&alternatives=true`;
  const data = await fetchJSON(url);
  if (data.code !== 'Ok' || !data.routes?.length) throw new Error('No route found.');
  return (data.routes as OsrmRoute[]).map(r => fromOsrm(r, mode));
}

/** Closures the community model has confirmed become polygons the router must avoid. */
export function closureAlerts(alerts: MapAlert[]) {
  return alerts.filter(a => a.status === 'confirmed' && a.stance && (a.topic === 'road_closure' || a.topic === 'flooding'));
}

export async function planRoute(from: Point, to: Point, mode: Mode, alerts: MapAlert[]): Promise<Route[]> {
  const closures = closureAlerts(alerts);
  const exclusions = closures.map(a => squareAround(a.longitude, a.latitude, Math.max(20, Math.min(a.radius_m, 40))));
  try {
    const [routes, baseline] = await Promise.all([
      valhalla(from, to, mode, exclusions, 1),
      exclusions.length ? valhalla(from, to, mode, [], 0).catch(() => null) : Promise.resolve(null),
    ]);
    if (baseline?.[0]) {
      const avoided = closures.filter(c => distanceToLine([c.longitude, c.latitude], baseline[0].coords) < 30).length;
      routes.forEach(r => { r.avoided = avoided; });
    }
    return routes;
  } catch {
    // Fallback: OSRM cannot avoid closures, but it keeps directions working when Valhalla is down.
    return osrm(from, to, mode);
  }
}
