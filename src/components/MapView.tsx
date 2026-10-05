import { useEffect, useImperativeHandle, useMemo, useRef, type Ref } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { MapAlert } from '../lib/community';
import type { LngLat } from '../lib/geo';
import { buildMapHtml } from './mapHtml';

export type MapConfig = { basemap: 'street' | 'satellite'; districts: boolean; buildings: boolean; roadNames: boolean; reports: boolean; debug: boolean };
export type MapMarker = { id: string; lat: number; lng: number; kind: 'start' | 'destination' };
export type UserPosition = { lat: number; lng: number; heading?: number | null; accuracy?: number | null };
export type TransportOverlay = { geometry: unknown; stops: { name: string; latitude: number; longitude: number }[] };

export type MapEvent =
  | { type: 'ready' }
  | { type: 'press' | 'longpress'; lat: number; lng: number }
  | { type: 'feature'; group: 'roads' | 'buildings'; id: string; name: string; props: Record<string, string>; lat: number; lng: number }
  | { type: 'center'; lat: number; lng: number; zoom: number; user: boolean }
  | { type: 'alert'; id: string }
  | { type: 'alternative'; index: number }
  | { type: 'district'; name: string }
  | { type: 'unfollow' }
  | { type: 'error'; message: string };

export type MapHandle = {
  flyTo: (lat: number, lng: number, zoom?: number) => void;
  fitRoute: () => void;
  fitDistrict: (name: string) => void;
};

type Props = {
  ref?: Ref<MapHandle>;
  config: MapConfig;
  alerts: MapAlert[];
  route?: LngLat[] | null;
  alternatives?: LngLat[][];
  fitRouteOnChange?: boolean;
  markers: MapMarker[];
  user?: UserPosition | null;
  follow: boolean;
  padding: { top: number; bottom: number };
  transport?: TransportOverlay[];
  onEvent: (event: MapEvent) => void;
};

export function MapView({ ref, config, alerts, route, alternatives, fitRouteOnChange, markers, user, follow, padding, transport, onEvent }: Props) {
  const web = useRef<WebView>(null);
  const ready = useRef(false);
  const latest = useRef<Map<string, object>>(new Map());
  const html = useMemo(buildMapHtml, []);

  // The latest message of each kind is kept and replayed whenever the page (re)loads.
  const send = (key: string, msg: object, replay = true) => {
    if (replay) latest.current.set(key, msg);
    if (ready.current) web.current?.injectJavaScript(`window.magaaloReceive(${JSON.stringify(JSON.stringify(msg))});true;`);
  };

  useImperativeHandle(ref, () => ({
    flyTo: (lat, lng, zoom) => send('view', { type: 'flyTo', lat, lng, zoom }, !ready.current),
    fitRoute: () => send('view', { type: 'fitRoute' }, !ready.current),
    fitDistrict: name => send('view', { type: 'fitDistrict', name }, !ready.current),
  }));

  useEffect(() => send('padding', { type: 'padding', ...padding }), [padding.top, padding.bottom]);
  useEffect(() => send('config', { type: 'config', config }), [config.basemap, config.districts, config.buildings, config.roadNames, config.reports, config.debug]);
  useEffect(() => send('alerts', { type: 'alerts', alerts }), [alerts, config.reports]);
  useEffect(() => send('route', { type: 'route', coords: route ?? null, alternatives: alternatives ?? [], fit: !!fitRouteOnChange }), [route, alternatives]);
  useEffect(() => send('markers', { type: 'markers', markers }), [markers]);
  useEffect(() => send('user', { type: 'user', user: user ?? null }), [user?.lat, user?.lng, user?.heading, user?.accuracy]);
  useEffect(() => send('follow', { type: 'follow', on: follow, zoom: 17 }), [follow]);
  useEffect(() => send('transport', { type: 'transport', routes: transport ?? [] }), [transport]);

  const onMessage = (event: WebViewMessageEvent) => {
    let msg: MapEvent;
    try { msg = JSON.parse(event.nativeEvent.data); } catch { return; }
    if (msg.type === 'ready') {
      ready.current = true;
      // Config first so the base layers exist before overlays are drawn; one-off view moves last.
      const order = (key: string) => (key === 'config' ? 0 : key === 'view' ? 2 : 1);
      const pending = [...latest.current.entries()].sort(([a], [b]) => order(a) - order(b));
      latest.current.delete('view');
      for (const [key, value] of pending) send(key, value, key !== 'view');
    }
    onEvent(msg);
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <WebView
        ref={web}
        originWhitelist={['*']}
        source={{ html, baseUrl: 'https://magaalo.app/' }}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
        cacheEnabled
        cacheMode="LOAD_CACHE_ELSE_NETWORK"
        setSupportMultipleWindows={false}
        bounces={false}
        overScrollMode="never"
        style={styles.web}
        onContentProcessDidTerminate={() => { ready.current = false; web.current?.reload(); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({ web: { flex: 1, backgroundColor: '#eef1ed' } });
