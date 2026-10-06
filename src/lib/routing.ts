import { ATLAS_WEBSITE, OSRM_SERVERS, VALHALLA_URL } from '../config';
import { decodePolyline, routeProgress, squareAround, type LngLat, type Point } from './geo';
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
  /** Community-confirmed closures this route avoids. */
  avoided: number;
  engine: 'osrm' | 'valhalla';
  /** Who answered: the Magaalo website's /api/route, or a direct call when the website was unreachable. */
  via: 'website' | 'direct';
};

const TIMEOUT = 22000;

async function fetchJSON(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body?.error || `Routing failed (${response.status})`), { status: response.status });
    return body;
  } finally {
    clearTimeout(timer);
  }
}

// ---- OSRM response (the website returns this format for every engine) → normalized steps ----
type OsrmStep = { name: string; distance: number; maneuver: { type: string; modifier?: Modifier; location: LngLat; exit?: number; bearing_after?: number } };
type OsrmRoute = { distance: number; duration: number; geometry: { coordinates: LngLat[] }; legs: { steps: OsrmStep[] }[] };

function stepKind(type: string): StepKind | null {
  switch (type) {
    case 'depart': return 'depart';
    case 'arrive': return 'arrive';
    case 'roundabout': case 'rotary': case 'roundabout turn': return 'roundabout';
    case 'exit roundabout': case 'exit rotary': return null; // folded into the roundabout step
    case 'merge': return 'merge';
    case 'fork': case 'on ramp': case 'off ramp': return 'keep';
    case 'continue': case 'new name': case 'notification': return 'continue';
    default: return 'turn'; // turn, end of road, …
  }
}

export function fromOsrm(route: OsrmRoute, engine: Route['engine'], via: Route['via'], avoided = 0): Route {
  const coords = route.geometry.coordinates;
  let previous = 0;
  const steps = route.legs.flatMap(leg => leg.steps).flatMap((s): Step[] => {
    const kind = stepKind(s.maneuver.type);
    if (!kind) return [];
    const match = routeProgress(s.maneuver.location, coords, previous);
    previous = match.index;
    const modifier = kind === 'keep' ? (s.maneuver.modifier?.includes('left') ? 'left' : 'right') : s.maneuver.modifier;
    return [{ kind, modifier, street: s.name || undefined, exit: s.maneuver.exit, bearingAfter: s.maneuver.bearing_after,
      distance: s.distance, location: s.maneuver.location, routeIndex: match.index }];
  });
  return { coords, distance: route.distance, duration: route.duration, steps, avoided, engine, via };
}

// ---- Direct fallbacks (same servers the website uses) ----
async function osrmDirect(from: Point, to: Point, mode: Mode): Promise<Route[]> {
  let lastError: unknown;
  for (const base of OSRM_SERVERS[mode]) {
    try {
      const data = await fetchJSON(`${base}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true&alternatives=3`);
      if (data.code === 'Ok' && data.routes?.length) return (data.routes as OsrmRoute[]).map(r => fromOsrm(r, 'osrm', 'direct'));
    } catch (error) { lastError = error; }
  }
  throw lastError ?? new Error('No route found.');
}

const VALHALLA_TYPES: Record<number, [string, Modifier?]> = {
  1: ['depart'], 2: ['depart', 'right'], 3: ['depart', 'left'], 4: ['arrive'], 5: ['arrive', 'right'], 6: ['arrive', 'left'],
  9: ['turn', 'slight right'], 10: ['turn', 'right'], 11: ['turn', 'sharp right'], 12: ['turn', 'uturn'], 13: ['turn', 'uturn'],
  14: ['turn', 'sharp left'], 15: ['turn', 'left'], 16: ['turn', 'slight left'], 18: ['on ramp', 'slight right'], 19: ['on ramp', 'slight left'],
  20: ['off ramp', 'slight right'], 21: ['off ramp', 'slight left'], 23: ['fork', 'slight right'], 24: ['fork', 'slight left'],
  25: ['merge'], 26: ['roundabout'], 27: ['exit roundabout'], 37: ['merge', 'slight right'], 38: ['merge', 'slight left'],
};
type ValhallaTrip = { legs: { shape: string; maneuvers: { type: number; street_names?: string[]; length: number; begin_shape_index: number; roundabout_exit_count?: number; bearing_after?: number }[] }[]; summary: { length: number; time: number } };

/** Closure detour only: Valhalla accepts exclusion polygons, the public OSRM servers do not. */
async function valhallaDetour(from: Point, to: Point, mode: Mode, exclude: LngLat[][]): Promise<Route[]> {
  const body = {
    locations: [{ lat: from.lat, lon: from.lng }, { lat: to.lat, lon: to.lng }],
    costing: mode === 'walking' ? 'pedestrian' : mode === 'cycling' ? 'bicycle' : 'auto',
    alternates: 1, units: 'kilometers', exclude_polygons: exclude,
  };
  const data = await fetchJSON(VALHALLA_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return [data.trip, ...(data.alternates ?? []).map((a: { trip: ValhallaTrip }) => a.trip)].filter(Boolean).map((trip: ValhallaTrip) => {
    const shape = decodePolyline(trip.legs[0].shape, 6);
    const legs = trip.legs.map(leg => ({ steps: leg.maneuvers.map(m => {
      const [type, modifier] = VALHALLA_TYPES[m.type] ?? ['continue', 'straight'];
      return { name: m.street_names?.join(', ') ?? '', distance: m.length * 1000,
        maneuver: { type, modifier, location: shape[m.begin_shape_index], exit: m.roundabout_exit_count, bearing_after: m.bearing_after } };
    }) }));
    return fromOsrm({ distance: trip.summary.length * 1000, duration: trip.summary.time, geometry: { coordinates: shape }, legs }, 'valhalla', 'direct');
  });
}

/** Closures the community model has confirmed. */
export function closureAlerts(alerts: MapAlert[]) {
  return alerts.filter(a => a.status === 'confirmed' && a.stance && (a.topic === 'road_closure' || a.topic === 'flooding'));
}

const hits = (route: Route, closures: MapAlert[]) =>
  closures.filter(c => routeProgress([c.longitude, c.latitude], route.coords, 0).distance < 30);

/**
 * Plans a route through the Magaalo website (/api/route: OSRM for driving, walking and cycling, with
 * community closures avoided server-side). Falls back to the same OSRM servers directly if the website
 * cannot be reached, and applies closure avoidance on the device in that case.
 */
export async function planRoute(from: Point, to: Point, mode: Mode, alerts: MapAlert[]): Promise<Route[]> {
  const closures = closureAlerts(alerts);
  let routes: Route[];
  let serverHandledClosures = false;
  try {
    const params = new URLSearchParams({ coordinates: `${from.lng},${from.lat};${to.lng},${to.lat}`, mode });
    const data = await fetchJSON(`${ATLAS_WEBSITE}/api/route?${params}`);
    // Newer website builds report the engine and handle closures; older ones return plain OSRM/Valhalla routes.
    serverHandledClosures = typeof data.avoided === 'number';
    const engine = data.engine === 'valhalla' ? 'valhalla' : mode === 'driving' || data.engine === 'osrm' ? 'osrm' : 'valhalla';
    routes = (data.routes as OsrmRoute[]).map(r => fromOsrm(r, engine, 'website', data.avoided ?? 0));
    // Older website builds collapse Valhalla walking/cycling turns into "continue"; use OSRM's foot/bike
    // profiles (what newer builds use) so turn-by-turn guidance has real turns.
    if (!serverHandledClosures && mode !== 'driving') routes = await osrmDirect(from, to, mode).catch(() => routes);
  } catch (error) {
    if ((error as { status?: number }).status === 422) throw error; // a real "no route" answer, not an outage
    routes = await osrmDirect(from, to, mode);
  }
  if (serverHandledClosures || !closures.length || !routes.length) return routes;

  const blocked = hits(routes[0], closures);
  if (!blocked.length) return [routes[0], ...routes.slice(1).filter(r => !hits(r, closures).length)];
  const clear = routes.filter(r => !hits(r, closures).length);
  if (clear.length) return clear.map(r => ({ ...r, avoided: blocked.length }));
  const exclude = closures.map(c => squareAround(c.longitude, c.latitude, Math.max(20, Math.min(c.radius_m, 40))));
  const detours = (await valhallaDetour(from, to, mode, exclude).catch(() => [])).filter(r => !hits(r, closures).length);
  return detours.length ? detours.map(r => ({ ...r, avoided: blocked.length })) : routes;
}
