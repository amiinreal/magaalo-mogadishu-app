import { useEffect, useImperativeHandle, useMemo, useRef, type Ref } from 'react';
import { StyleSheet, View } from 'react-native';
import { MapSurface, type SurfaceHandle } from './MapSurface';
import type { MapAlert } from '../lib/community';
import type { LngLat } from '../lib/geo';
import { buildMapHtml, MAP_BASE_URL } from './mapHtml';

export type MapConfig = {
  basemap: 'street' | 'satellite'; roads: boolean; buildings: boolean; places: boolean; community: boolean;
  transport: boolean; districts: boolean; alerts: boolean; debug: boolean; districtOpacity: number;
};
export type MapMarker = { id: string; lat: number; lng: number; kind: 'start' | 'destination' | 'access' };
export type UserPosition = { lat: number; lng: number; heading?: number | null; accuracy?: number | null };
export type Geometry = { type: 'Point' | 'LineString' | 'Polygon' | 'MultiLineString' | 'MultiPolygon'; coordinates: unknown };
export type MapFeature = { type: 'Feature'; id: string; geometry: Geometry; properties: Record<string, string | number | undefined> };
export type Access = { lng: number; lat: number; street: string | null; distance: number; source: 'network' | 'device' };
export type DrawMode = 'Point' | 'LineString' | 'Polygon';
export type CommunitySuggestion = { id: string; kind: string; name: string; notes: string; geometry: Geometry };

export type MapEvent =
  | { type: 'ready' }
  | { type: 'press' | 'longpress'; lat: number; lng: number }
  | { type: 'feature'; feature: MapFeature; lat: number; lng: number }
  | { type: 'place'; feature: MapFeature }
  | { type: 'community'; suggestion: CommunitySuggestion }
  | { type: 'center'; lat: number; lng: number; zoom: number; user: boolean }
  | { type: 'alert'; id: string }
  | { type: 'alternative'; index: number }
  | { type: 'district'; name: string }
  | { type: 'drawPoints'; count: number }
  | { type: 'drawn'; geometry: Geometry | null }
  | { type: 'atlas'; counts: Record<string, number>; osm_timestamp: string; prepared_at: string }
  | { type: 'transport'; routes: number; stops: number; vehicles: number }
  | { type: 'status'; message: 'atlas-unavailable' | 'satellite-failed' }
  | { type: 'unfollow' } | { type: 'outside' }
  | { type: 'error'; message: string };

export type MapHandle = {
  flyTo: (lat: number, lng: number, zoom?: number) => void;
  fitRoute: () => void;
  fitCity: () => void;
  fitDistrict: (name: string) => void;
  refresh: () => void;
  draw: (mode: DrawMode | null) => void;
  undoDraw: () => void;
  finishDraw: () => void;
  /** Where a building/place meets the road network (precomputed network tiles, else computed on the device). */
  access: (lat: number, lng: number, featureId?: string, kind?: 'place' | 'building') => Promise<Access | null>;
};

type Props = {
  ref?: Ref<MapHandle>;
  config: MapConfig;
  alerts: MapAlert[];
  route?: LngLat[] | null;
  alternatives?: LngLat[][];
  walkTo?: LngLat | null;
  fitRouteOnChange?: boolean;
  markers: MapMarker[];
  user?: UserPosition | null;
  follow: boolean;
  padding: { top: number; bottom: number };
  onEvent: (event: MapEvent) => void;
};

export function MapView({ ref, config, alerts, route, alternatives, walkTo, fitRouteOnChange, markers, user, follow, padding, onEvent }: Props) {
  const web = useRef<SurfaceHandle>(null);
  const ready = useRef(false);
  const latest = useRef<Map<string, object>>(new Map());
  const pending = useRef(new Map<string, (a: Access | null) => void>());
  const html = useMemo(() => buildMapHtml(), []);

  // The latest message of each kind is kept and replayed whenever the page (re)loads.
  const send = (key: string, msg: object, replay = true) => {
    if (replay) latest.current.set(key, msg);
    if (ready.current) web.current?.send(JSON.stringify(msg));
  };
  const once = (msg: object) => send('view', msg, !ready.current);

  useImperativeHandle(ref, () => ({
    flyTo: (lat, lng, zoom) => once({ type: 'flyTo', lat, lng, zoom }),
    fitRoute: () => once({ type: 'fitRoute' }),
    fitCity: () => once({ type: 'fitBounds' }),
    fitDistrict: name => once({ type: 'fitDistrict', name }),
    refresh: () => send('refresh', { type: 'refresh' }, false),
    draw: mode => send('draw', { type: 'draw', mode }, false),
    undoDraw: () => send('drawUndo', { type: 'drawUndo' }, false),
    finishDraw: () => send('drawFinish', { type: 'drawFinish' }, false),
    access: (lat, lng, featureId, kind) => new Promise(resolve => {
      const requestId = `${Date.now()}-${Math.random()}`;
      pending.current.set(requestId, resolve);
      setTimeout(() => { if (pending.current.delete(requestId)) resolve(null); }, 12000);
      send('access', { type: 'access', requestId, lat, lng, featureId, kind }, false);
    }),
  }));

  useEffect(() => send('padding', { type: 'padding', ...padding }), [padding.top, padding.bottom]);
  useEffect(() => send('config', { type: 'config', config }), [JSON.stringify(config)]);
  useEffect(() => send('alerts', { type: 'alerts', alerts }), [alerts]);
  useEffect(() => send('route', { type: 'route', coords: route ?? null, alternatives: alternatives ?? [], walkTo: walkTo ?? null, fit: !!fitRouteOnChange }), [route, alternatives, walkTo]);
  useEffect(() => send('markers', { type: 'markers', markers }), [markers]);
  useEffect(() => send('user', { type: 'user', user: user ?? null }), [user?.lat, user?.lng, user?.heading, user?.accuracy]);
  useEffect(() => send('follow', { type: 'follow', on: follow, zoom: 17 }), [follow]);

  const onMessage = (data: string) => {
    let msg: MapEvent & { requestId?: string; access?: Access | null };
    try { msg = JSON.parse(data); } catch { return; }
    if ((msg as { type: string }).type === 'access' && msg.requestId) {
      pending.current.get(msg.requestId)?.(msg.access ?? null);
      pending.current.delete(msg.requestId);
      return;
    }
    if (msg.type === 'ready') {
      ready.current = true;
      // Config first so the base layers exist before overlays are drawn; one-off view moves last.
      const order = (key: string) => (key === 'config' ? 0 : key === 'view' ? 2 : 1);
      const queued = [...latest.current.entries()].sort(([a], [b]) => order(a) - order(b));
      latest.current.delete('view');
      for (const [key, value] of queued) send(key, value, key !== 'view');
    }
    onEvent(msg);
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapSurface ref={web} html={html} baseUrl={MAP_BASE_URL} onMessage={onMessage} onReload={() => { ready.current = false; }} />
    </View>
  );
}
